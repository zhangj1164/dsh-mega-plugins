#!/usr/bin/env node

import fs from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import config from './config.json' with { type: 'json' }

const API_VERSION = '2026-03-10'
const BODY_LIMIT = 50
const AUDIT_MARKER = '<!-- dsh-mega-plugins-issue-policy -->'
const OWNER_LINE = /^Owner: @([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)$/
// Category roles this tracker actually enforces. Native Issue Types
// (Idea/Feature/Bug/Research/Task) are an organization-only GitHub feature: a
// user-owned repository reports none for any Issue, so requiring one can never
// pass here. See the deferred notes inside `validateIssue`.
const CATEGORY_LABELS = new Set(['bug', 'enhancement'])
const PRIORITIES = ['p0', 'p1', 'p2', 'p3']
const PR_KINDS = new Set([
  'kind/feature',
  'kind/bug-fix',
  'kind/doc',
  'kind/testing',
  'kind/cleanup',
  'kind/dependency',
])
const LEGACY_LABELS = new Set([
  'kind/bug',
  'kind/documentation',
  'feature',
  'bug-fix',
  'doc',
  'cleanup',
  'testing',
  'dependencies',
  'ci',
  'cli',
  'llm',
  'web-search',
])
const TERMINAL_STATUSES = new Set(['Done', 'No action'])
const ACTIVE_STATUS_ORDER = config.statuses.filter((status) => !TERMINAL_STATUSES.has(status))
const IMPLEMENTATION_PULL_REQUEST_ACTIONS = new Set([
  'opened',
  'edited',
  'synchronize',
  'reopened',
  'labeled',
  'unlabeled',
])

for (const status of ['In progress', 'In review']) {
  if (!ACTIVE_STATUS_ORDER.includes(status)) throw new Error(`config.statuses 缺少 ${status}`)
}
if (typeof config.lifecycleActor !== 'string' || !config.lifecycleActor) {
  throw new Error('config.lifecycleActor 未设置')
}

/**
 * Return Markdown outside balanced details elements.
 * @param {string} body Markdown body.
 * @returns {{text: string, balanced: boolean, detailsCount: number, allCollapsed: boolean}} Visible source and details shape.
 */
export function extractOutsideDetails(body) {
  const source = body.replace(/<!--[\s\S]*?-->/g, '')
  const tag = /<\/?details\b[^>]*>/gi
  let depth = 0
  let cursor = 0
  let balanced = true
  let text = ''
  let detailsCount = 0
  let allCollapsed = true

  for (const match of source.matchAll(tag)) {
    const index = match.index ?? 0
    if (depth === 0) text += source.slice(cursor, index)
    if (/^<\//.test(match[0])) {
      if (depth === 0) balanced = false
      else depth -= 1
    } else {
      depth += 1
      detailsCount += 1
      if (/\sopen(?:\s|=|>)/i.test(match[0])) allCollapsed = false
    }
    cursor = index + match[0].length
  }

  if (depth === 0) text += source.slice(cursor)
  if (depth !== 0) balanced = false
  return { text, balanced, detailsCount, allCollapsed }
}

/**
 * Count Chinese characters and contiguous Latin, numeric, or code tokens.
 * @param {string} body Markdown body.
 * @returns {{units: number, balanced: boolean, detailsCount: number, allCollapsed: boolean}} Visible unit count and details shape.
 */
export function countVisibleUnits(body) {
  const outside = extractOutsideDetails(body)
  const visible = outside.text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:[A-Za-z]+|#\d+|#x[0-9A-Fa-f]+);/g, ' ')
    .replace(/[\u0060*~\[\]{}()<>#!|]/g, ' ')
  const han = visible.match(/\p{Script=Han}/gu)?.length ?? 0
  const tokens = visible.match(/[\p{Script=Latin}\p{Number}_./:@+-]+/gu)?.length ?? 0
  return {
    units: han + tokens,
    balanced: outside.balanced,
    detailsCount: outside.detailsCount,
    allCollapsed: outside.allCollapsed,
  }
}

function firstNonblankLine(body) {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

/**
 * Validate required body sections and check Owner against assignees.
 * @param {{body: string, assignees: string[], allowUnassignedOwner?: boolean}} input Body input.
 * @returns {string[]} Validation errors.
 */
export function validateBody({
  body,
  assignees,
  allowUnassignedOwner = config.allowUnassignedOwner ?? false,
}) {
  const errors = []
  const count = countVisibleUnits(body)
  const owner = firstNonblankLine(body)?.match(OWNER_LINE)?.[1] ?? null
  const normalized = [...new Set(assignees.map((login) => login.toLowerCase()))]

  if (!count.balanced) errors.push('details 标签必须成对闭合')
  if (count.detailsCount === 0) errors.push('正文必须包含默认收起的 <details> 区域')
  if (!count.allCollapsed) errors.push('details 必须默认收起，不得设置 open')
  if (count.units > BODY_LIMIT) {
    errors.push(`正文外露部分为 ${count.units} 单位，超过 50 单位`)
  }
  if (normalized.length >= 2 && !owner) {
    errors.push('多个 Assignees 时首个非空行必须是 Owner: @login')
  } else if (normalized.length >= 2 && !normalized.includes(owner.toLowerCase())) {
    errors.push('Owner 必须属于 Assignees')
  } else if (
    normalized.length < 2 &&
    owner &&
    !(normalized.length === 0 && allowUnassignedOwner)
  ) {
    errors.push('零或一个 Assignee 时不得写 Owner 行')
  }
  return errors
}

/**
 * Decide whether the human-review policy applies to a PR.
 * @param {{isDraft: boolean, authorType: string, reviewRequestCount: number, reviewCount: number}} input PR state.
 * @returns {boolean} Whether the PR policy is mandatory.
 */
export function requiresPullRequestPolicy({
  isDraft,
  authorType,
  reviewRequestCount,
  reviewCount,
}) {
  const automated = authorType === 'Bot' || authorType === 'App'
  return !isDraft && !automated && (reviewRequestCount > 0 || reviewCount > 0)
}

/**
 * Translate a repository event into one resolving-Issue lifecycle command.
 * @param {string} eventName GitHub event name.
 * @param {{action?: string, review?: {state?: string}}} event GitHub event payload.
 * @returns {'implementation'|'review-requested'|'changes-requested'|null} Lifecycle command.
 */
export function resolvingIssueStatusCommand(eventName, event) {
  if (eventName === 'pull_request') {
    if (event.action === 'review_requested') return 'review-requested'
    return IMPLEMENTATION_PULL_REQUEST_ACTIONS.has(event.action) ? 'implementation' : null
  }
  if (
    eventName === 'pull_request_review' &&
    event.action === 'submitted' &&
    event.review?.state?.toLowerCase() === 'changes_requested'
  ) {
    return 'changes-requested'
  }
  return null
}

/**
 * Plan one event-directed resolving-Issue status transition.
 * @param {string|null} currentStatus Current Project status.
 * @param {'implementation'|'review-requested'|'changes-requested'} command Lifecycle command.
 * @param {string|null} currentStatusActor Actor that last set the current Project status.
 * @returns {string|null} Status to write, or null when no permitted transition exists.
 */
export function nextResolvingIssueStatus(currentStatus, command, currentStatusActor = null) {
  let target
  if (command === 'review-requested') target = 'In review'
  else if (command === 'implementation' || command === 'changes-requested') target = 'In progress'
  else throw new Error(`未知 lifecycle command：${command}`)

  const currentIndex = ACTIVE_STATUS_ORDER.indexOf(currentStatus)
  const targetIndex = ACTIVE_STATUS_ORDER.indexOf(target)
  if (
    command === 'changes-requested' &&
    currentStatus === 'In review' &&
    currentStatusActor === config.lifecycleActor
  ) {
    return target
  }
  return currentIndex >= 0 && currentIndex < targetIndex ? target : null
}

function stripIgnoredMarkdown(body) {
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const kept = []
  let fence = null
  for (const line of lines) {
    const marker = line.match(/^\s*([\u0060~]{3,})/)
    if (marker) {
      if (fence === null) fence = marker[1][0]
      else if (marker[1][0] === fence) fence = null
      continue
    }
    if (fence === null) kept.push(line)
  }
  return kept.join('\n').replace(/\u0060[^\u0060]*\u0060/g, ' ')
}

/**
 * Parse same-repository resolving and informational references.
 * @param {{body: string, repository: string}} input PR body and repository.
 * @returns {{all: number[], resolving: number[], related: number[]}} References.
 */
export function parseReferences({ body, repository }) {
  const source = stripIgnoredMarkdown(body)
  const expected = repository.toLowerCase()
  const all = new Set()
  const resolving = new Set()
  const reference =
    /(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#|#)(\d+)|https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+)/gi
  const closing =
    /\b(?:close(?:s|d)?|fix(?:es|ed)?|resolve(?:s|d)?)\s*:?\s+(?:(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#|#)(\d+)|https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+))/gi

  for (const match of source.matchAll(reference)) {
    const explicit = (match[1] ?? match[3] ?? '').toLowerCase()
    const number = Number(match[2] ?? match[4])
    if (!explicit || explicit === expected) all.add(number)
  }
  for (const match of source.matchAll(closing)) {
    const explicit = (match[1] ?? match[3] ?? '').toLowerCase()
    const number = Number(match[2] ?? match[4])
    if (!explicit || explicit === expected) {
      all.add(number)
      resolving.add(number)
    }
  }
  return {
    all: [...all].sort((left, right) => left - right),
    resolving: [...resolving].sort((left, right) => left - right),
    related: [...all].filter((number) => !resolving.has(number)).sort((a, b) => a - b),
  }
}

/**
 * Retain only references that resolve to Issues rather than pull requests.
 * @param {{all: number[], resolving: number[], related: number[]}} references Parsed references.
 * @param {Map<number, unknown>} issues Resolved same-repository Issues.
 * @returns {{all: number[], resolving: number[], related: number[]}} Issue-only references.
 */
export function retainIssueReferences(references, issues) {
  return {
    all: references.all.filter((number) => issues.has(number)),
    resolving: references.resolving.filter((number) => issues.has(number)),
    related: references.related.filter((number) => issues.has(number)),
  }
}

/**
 * Validate one Issue, consulting a Project Status only when the caller could read it.
 * A closed Issue returns no errors: it was filed under whatever rules existed then,
 * and both callers — the event gate and the lifecycle audit — would otherwise turn a
 * historical record red for rules it never had a chance to meet.
 * @param {{title: string, body: string, assignees: string[], labels: string[], priority: string|null, status: string|null, projectChecked?: boolean, state: string, stateReason: string|null}} issue Issue snapshot; `projectChecked` marks a snapshot whose Project was actually read.
 * @returns {string[]} Validation errors.
 */
export function validateIssue(issue) {
  if (issue.state === 'closed') return []
  const errors = validateBody(issue)
  // Normalize both "no Status reported" spellings: a caller that omits the field
  // entirely must read the same as one that reports `null`.
  const status = issue.status ?? null
  const invalidLabels = issue.labels.filter(
    (label) => label.startsWith('kind/') || LEGACY_LABELS.has(label),
  )

  if (!/\p{Script=Han}/u.test(issue.title)) errors.push('Issue 标题必须包含中文')
  if (invalidLabels.length > 0) {
    errors.push(`Issue 不得使用 PR kind 或旧版标签：${invalidLabels.join(', ')}`)
  }
  const categories = issue.labels.filter((label) => CATEGORY_LABELS.has(label))
  if (categories.length !== 1) {
    errors.push(`Issue 必须恰好有一个分类标签：${[...CATEGORY_LABELS].join(' 或 ')}`)
  }
  if (
    /^\s*(?:\[(?:Idea|Feature|Bug|Research|Task|P[0-3]|Inbox|Backlog|Ready|In progress|In review|Done|No action|Owner|area\/[^\]]+)[^\]]*\]|(?:Idea|Feature|Bug|Research|Task|P[0-3]|Inbox|Backlog|Ready|In progress|In review|Done|No action|Owner|area\/[^:： ]+)\s*[:：-])/iu.test(
      issue.title,
    )
  ) {
    errors.push('Issue 标题不得带 Type、Priority、Status、area 或 Owner 前缀')
  }
  // No native Type check: types are an organization-only GitHub feature, so a
  // user-owned repository reports none for any Issue. Restore it when the
  // repository moves into an organization and the templates' `type` frontmatter
  // starts producing a value; until then the category label below carries the role.
  // A Status is required only when the caller actually read the Project: the
  // payload-only gate consults no Project, so it reports `projectChecked: false`
  // and an absent Status there means "not checked", not "violates policy".
  // `issueSnapshot` marks every Project read, and `runIssueCheck` reads the
  // Project whenever the project gate holds its `project`-scoped token, so under
  // the enabled gate a missing item — or an item without a Status — is
  // reportable again.
  if (issue.projectChecked === true && status === null) {
    errors.push('Issue 必须加入 Project，并具有合法的 Status')
  }
  if (status !== null && !config.statuses.includes(status)) {
    errors.push(`Status 不在允许集合内：${status}`)
  }
  if (issue.priority !== null && !PRIORITIES.includes(issue.priority.toLowerCase())) {
    errors.push('Priority 必须为空或为 P0–P3')
  }
  if (status === 'Done' && (issue.state !== 'closed' || issue.stateReason !== 'completed')) {
    errors.push('Done 必须对应 Completed 关闭原因')
  }
  if (
    status === 'No action' &&
    (issue.state !== 'closed' || issue.stateReason !== 'not_planned')
  ) {
    errors.push('No action 必须对应 Not planned 关闭原因')
  }
  if (
    status !== null &&
    !TERMINAL_STATUSES.has(status) &&
    issue.state !== 'open'
  ) {
    errors.push(`${status} 必须对应开放 Issue`)
  }
  return errors
}

/**
 * Validate one `issues` event payload as the gate receives it, from the payload
 * alone — no token, no Project read. `priority` and `status` are reported as
 * absent rather than missing, which the validator treats as "not checked"; `state`
 * travels with them so the deferred Status rules apply unchanged once the Project
 * half lands, and so a closed Issue is skipped in `validateIssue`.
 * @param {{issue: {title?: string, body?: string|null, assignees?: {login: string}[], labels?: ({name: string}|string)[], state?: string, state_reason?: string|null}}} event `issues` event payload.
 * @returns {string[]} Validation errors.
 */
export function validateIssueEvent(event) {
  const issue = event.issue ?? {}
  return validateIssue({
    title: issue.title ?? '',
    body: issue.body ?? '',
    assignees: (issue.assignees ?? []).map((assignee) => assignee.login),
    labels: (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name)),
    priority: null,
    status: null,
    state: issue.state ?? 'open',
    stateReason: issue.state_reason ?? null,
  })
}

/**
 * Validate PR metadata and its referenced Issues.
 * @param {{authorType: string, labels: string[], references: ReturnType<typeof parseReferences>, issues: Map<number, {priority: string|null}>}} input PR snapshot.
 * @returns {string[]} Validation errors.
 */
export function validatePullRequest(input) {
  if (!requiresPullRequestPolicy(input)) return []
  const errors = []
  const kinds = input.labels.filter((label) => PR_KINDS.has(label))
  const unknownKinds = input.labels.filter(
    (label) => label.startsWith('kind/') && !PR_KINDS.has(label) && !LEGACY_LABELS.has(label),
  )
  const legacyLabels = input.labels.filter((label) => LEGACY_LABELS.has(label))
  const sourceLabels = input.labels.filter((label) => label.startsWith('source/'))
  const priorities = input.labels.filter((label) => PRIORITIES.includes(label))
  const areas = input.labels.filter((label) => label.startsWith('area/'))

  if (input.references.all.length === 0) errors.push('PR 正文必须引用至少一个同仓库 Issue')
  if (kinds.length !== 1) {
    errors.push(`PR 必须恰好有一个允许的 kind/*，当前为 ${kinds.length}`)
  }
  if (unknownKinds.length > 0) {
    errors.push(`PR 含不支持的 kind/*：${unknownKinds.join(', ')}`)
  }
  if (legacyLabels.length > 0) errors.push(`PR 含旧版标签：${legacyLabels.join(', ')}`)
  if (sourceLabels.length > 0) errors.push(`source/* 仅用于 Issue：${sourceLabels.join(', ')}`)
  if (priorities.length > 1) errors.push(`PR 最多有一个 p0–p3，当前为 ${priorities.length}`)
  if (areas.length === 0) errors.push('PR 必须至少有一个 area/*')
  for (const number of input.references.all) {
    if (!input.issues.has(number)) errors.push(`#${number} 不是同仓库 Issue`)
  }

  const resolving = input.references.resolving
    .map((number) => [number, input.issues.get(number)])
    .filter((entry) => entry[1])
  if (resolving.length === 0) return errors

  const issuePriorities = resolving
    .map(([, issue]) => issue.priority?.toLowerCase())
    .filter((priority) => PRIORITIES.includes(priority))
  if (priorities.length === 0 && issuePriorities.length > 0) {
    const highest = issuePriorities.sort(
      (left, right) => PRIORITIES.indexOf(left) - PRIORITIES.indexOf(right),
    )[0]
    errors.push(`PR Priority 应为 ${highest}`)
  } else if (priorities.length === 1 && issuePriorities.length !== resolving.length) {
    errors.push('有 Priority 的解决型 PR 要求每个被解决 Issue 都设置 Priority')
  } else if (priorities.length === 1) {
    const highest = issuePriorities.sort(
      (left, right) => PRIORITIES.indexOf(left) - PRIORITIES.indexOf(right),
    )[0]
    if (priorities[0] !== highest) errors.push(`PR Priority 应为 ${highest}`)
  }
  return errors
}

function token() {
  const value = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!value) throw new Error('GH_TOKEN 或 GITHUB_TOKEN 未设置')
  return value
}

/**
 * Token for Project (GraphQL) calls.
 * The Projects board is owned by a user account, which neither a GitHub App
 * token nor a fine-grained PAT can reach: only a classic PAT with the `project`
 * scope grants it. That token is deliberately narrow, so it is used for nothing
 * else — every repository call keeps the workflow's own `github.token`.
 * @returns {string} A token that may read and write the Project board.
 */
function projectToken() {
  const value = process.env.DSH_PROJECT_TOKEN
  if (value) return value
  // An enabled gate without its token is a misconfiguration, not a reason to
  // fall back: the repository token cannot reach a user-owned Project, so the
  // fallback would only turn a missing secret into a misleading permission error.
  if (process.env.DSH_PROJECT_GATE === 'true') {
    throw new Error('DSH_PROJECT_TOKEN 未设置：Project 校验已启用，但没有 project scope 的 token')
  }
  return token()
}

async function api(path, options = {}) {
  const { token: override, ...init } = options
  const response = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${override ?? token()}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'dsh-mega-plugins-issue-policy',
      ...options.headers,
    },
  })
  if (options.allow404 && response.status === 404) return null
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${options.method ?? 'GET'} ${path}: ${response.status} ${body}`)
  }
  if (response.status === 204) return null
  return response.json()
}

async function graphql(query, variables) {
  const result = await api('/graphql', {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
    headers: { 'Content-Type': 'application/json' },
    token: projectToken(),
  })
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join('; '))
  return result.data
}

/**
 * Read one Issue snapshot, and its Project Status when the caller did not supply one.
 * @param {number} number Issue number.
 * @param {string|null|undefined} status Current Status; `undefined` reads the Project and marks the snapshot `projectChecked`, while an explicit `null` reports "not consulted".
 * @returns {Promise<object|null>} The snapshot, or null for a missing Issue or a pull request.
 */
async function issueSnapshot(number, status = undefined) {
  const consulted = status === undefined
  const issue = await api(`/repos/${config.organization}/${config.repository}/issues/${number}`, { allow404: true })
  if (!issue || issue.pull_request) return null
  // Issue field values are an organization-only endpoint. In a user-owned
  // repository it answers 404, which is not an error: there are simply no
  // custom single-select fields, so Priority falls back to null.
  const values = await api(
    `/repos/${config.organization}/${config.repository}/issues/${number}/issue-field-values?per_page=100`,
    { allow404: true },
  ) ?? []
  const field = (name) => values.find((value) => value.issue_field_name === name)
  return {
    number,
    nodeId: issue.node_id,
    title: issue.title,
    body: issue.body ?? '',
    assignees: issue.assignees.map((assignee) => assignee.login),
    labels: issue.labels.map((label) => label.name),
    priority: field(config.priorityField)?.single_select_option?.name ?? null,
    status: consulted ? await projectStatus(number) : status,
    projectChecked: consulted,
    state: issue.state,
    stateReason: issue.state_reason ?? null,
  }
}

/**
 * Actor that last set the Status a Project item currently shows.
 * A snapshot whose query did not ask for status events carries no timeline, and
 * an Issue outside the board has no Status at all. Both are "unknown actor", not
 * "no change": comparing two absences would answer true and then dereference the
 * missing event, so each one returns null on its own.
 * @param {Array<{status: string|null, actor: {login: string}|null}>|null|undefined} events Status-change events, oldest first.
 * @param {string|null} currentStatus Status the item currently shows, or null when it shows none.
 * @returns {string|null} Login of the actor that set that Status, or null when it is unknown.
 */
export function statusActorOf(events, currentStatus) {
  const latest = events ? events.filter((event) => event).at(-1) : undefined
  if (!latest || currentStatus === null) return null
  return latest.status === currentStatus ? (latest.actor?.login ?? null) : null
}

async function projectContext(number, includeStatusActor = false) {
  const data = await graphql(
    `query(
      $owner: String!
      $repository: String!
      $number: Int!
      $project: Int!
      $includeStatusActor: Boolean!
    ) {
      repository(owner: $owner, name: $repository) {
        owner {
          ... on User {
            projectV2(number: $project) { ...ProjectFields }
          }
          ... on Organization {
            projectV2(number: $project) { ...ProjectFields }
          }
        }
        issue(number: $number) {
          id
          timelineItems(last: 100, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT])
            @include(if: $includeStatusActor) {
            nodes {
              ... on ProjectV2ItemStatusChangedEvent {
                actor { login }
                project { id }
                status
              }
            }
          }
          projectItems(first: 20, includeArchived: true) {
            nodes {
              id
              project { id }
              fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
              }
            }
          }
        }
      }
    }

    fragment ProjectFields on ProjectV2 {
      id
      title
      fields(first: 50) {
        nodes {
          ... on ProjectV2SingleSelectField { id name options { id name } }
        }
      }
    }`,
    {
      owner: config.organization,
      repository: config.repository,
      number,
      project: config.projectNumber,
      includeStatusActor,
    },
  )
  // The board belongs to whoever owns the repository, and that owner is a user
  // here, not an organization: `organization(login:)` answers NOT_FOUND for it.
  // Reading the project through `repository.owner` keeps the query correct
  // either way, so the same code works if the repository ever moves.
  const project = data.repository?.owner?.projectV2
  const issue = data.repository?.issue
  if (!project || project.title !== config.projectTitle) throw new Error('目标 Project 不存在或标题不匹配')
  if (!issue) throw new Error(`#${number} 不存在`)
  const statusField = project.fields.nodes.find((field) => field?.name === 'Status')
  if (!statusField) throw new Error('Project 缺少 Status 字段')
  const item = issue.projectItems.nodes.find((candidate) => candidate.project.id === project.id)
  const statusActor = statusActorOf(
    issue.timelineItems?.nodes?.filter((event) => event?.project?.id === project.id),
    item?.fieldValueByName?.name ?? null,
  )
  return { project, issue, statusField, item, statusActor }
}

async function projectStatus(number) {
  const context = await projectContext(number)
  return context.item?.fieldValueByName?.name ?? null
}

async function ensureProjectItem(number) {
  const context = await projectContext(number)
  if (context.item) return context
  const data = await graphql(
    `mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item { id }
      }
    }`,
    { projectId: context.project.id, contentId: context.issue.id },
  )
  return {
    ...context,
    item: { id: data.addProjectV2ItemById.item.id, fieldValueByName: null },
  }
}

async function updateStatus(context, status) {
  const option = context.statusField.options.find((candidate) => candidate.name === status)
  if (!option) throw new Error(`Status 不存在：${status}`)
  if (context.item.fieldValueByName?.name === status) return
  await graphql(
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: {singleSelectOptionId: $optionId}
      }) { projectV2Item { id } }
    }`,
    {
      projectId: context.project.id,
      itemId: context.item.id,
      fieldId: context.statusField.id,
      optionId: option.id,
    },
  )
}

async function setStatus(number, status) {
  await updateStatus(await ensureProjectItem(number), status)
}

async function upsertAudit(number, errors) {
  const comments = await api(
    `/repos/${config.organization}/${config.repository}/issues/${number}/comments?per_page=100`,
  )
  const existing = comments.find(
    (comment) => comment.user?.type === 'Bot' && comment.body?.includes(AUDIT_MARKER),
  )
  if (errors.length === 0) {
    if (existing) {
      await api(`/repos/${config.organization}/${config.repository}/issues/comments/${existing.id}`, {
        method: 'DELETE',
      })
    }
    return
  }
  const body = `${AUDIT_MARKER}\n⚠️ Issue policy 未通过：\n\n${errors.map((error) => `- ${error}`).join('\n')}`
  if (existing) {
    if (existing.body === body) return
    await api(`/repos/${config.organization}/${config.repository}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
      headers: { 'Content-Type': 'application/json' },
    })
  } else {
    await api(`/repos/${config.organization}/${config.repository}/issues/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

async function auditIssue(number, extraErrors = [], status = undefined) {
  const issue = await issueSnapshot(number, status)
  if (!issue) return []
  const errors = [...extraErrors, ...validateIssue(issue)]
  await upsertAudit(number, errors)
  return errors
}

async function resolvingReferencesSnapshot(number, pull) {
  const references = parseReferences({
    body: pull.body ?? '',
    repository: `${config.organization}/${config.repository}`,
  })
  const issues = new Map()
  for (const issueNumber of references.all) {
    const issue = await issueSnapshot(issueNumber, null)
    if (issue) issues.set(issueNumber, issue)
  }
  return {
    number,
    references: retainIssueReferences(references, issues),
    issues,
  }
}

async function pullRequestSnapshot(number) {
  const [pull, reviewRequests, reviews] = await Promise.all([
    api(`/repos/${config.organization}/${config.repository}/pulls/${number}`),
    api(`/repos/${config.organization}/${config.repository}/pulls/${number}/requested_reviewers`),
    api(`/repos/${config.organization}/${config.repository}/pulls/${number}/reviews?per_page=100`),
  ])
  const resolving = await resolvingReferencesSnapshot(number, pull)
  return {
    ...resolving,
    isDraft: pull.draft,
    authorType: pull.user?.type ?? 'User',
    reviewRequestCount: reviewRequests.users.length + reviewRequests.teams.length,
    reviewCount: reviews.length,
    labels: pull.labels.map((label) => label.name),
  }
}

async function lifecyclePullRequestSnapshot(number) {
  const pull = await api(`/repos/${config.organization}/${config.repository}/pulls/${number}`)
  return resolvingReferencesSnapshot(number, pull)
}

async function transitionResolvingIssues(pull, command) {
  for (const number of pull.references.resolving) {
    const context = await projectContext(number, command === 'changes-requested')
    const target = nextResolvingIssueStatus(
      context.item?.fieldValueByName?.name ?? null,
      command,
      context.statusActor,
    )
    if (!target) continue
    await updateStatus(context, target)
    await auditIssue(number)
  }
}

function reportPolicyErrors(errors) {
  for (const error of errors) process.stdout.write(`::error::${error}\n`)
  if (errors.length > 0) throw new Error(`Issue policy 未通过，共 ${errors.length} 项`)
}

async function runPullRequestCheck(event) {
  const pull = await pullRequestSnapshot(event.pull_request.number)
  reportPolicyErrors(validatePullRequest(pull))
  process.stdout.write(
    requiresPullRequestPolicy(pull) ? 'Issue policy 通过。\n' : 'PR 尚未进入 Issue policy 强制范围。\n',
  )
}

/**
 * Whether the Project half of the gate is configured.
 * The workflow sets this from a repository variable, because a secret cannot be
 * referenced in a step condition; the same switch turns on the lifecycle job.
 * @returns {boolean} True when the Project read and its Status requirement apply.
 */
function projectGateEnabled() {
  return process.env.DSH_PROJECT_GATE === 'true'
}

async function runIssueCheck(event) {
  // With the gate off there is no Project token, so the payload is all the gate
  // can judge. With it on, the Project is read first and its Status enters the
  // same validation, which is what makes a missing item reportable.
  if (!projectGateEnabled()) {
    reportPolicyErrors(validateIssueEvent(event))
    process.stdout.write('Issue policy 通过（Project 校验未启用）。\n')
    return
  }
  const issue = await issueSnapshot(event.issue.number)
  if (!issue) throw new Error(`#${event.issue.number} 不是同仓库 Issue`)
  reportPolicyErrors(validateIssue(issue))
  process.stdout.write('Issue policy 通过。\n')
}

async function runLifecycle(eventName, event) {
  if (eventName === 'issues') {
    const number = event.issue.number
    if (event.action === 'opened') await setStatus(number, 'Inbox')
    if (event.action === 'closed') {
      const target = event.issue.state_reason === 'not_planned' ? 'No action' : 'Done'
      await setStatus(number, target)
    }
    if (event.action === 'reopened') {
      await setStatus(number, 'Inbox')
    }
    await ensureProjectItem(number)
    await auditIssue(number)
    return
  }

  if (eventName === 'pull_request' || eventName === 'pull_request_review') {
    const command = resolvingIssueStatusCommand(eventName, event)
    if (!command) return
    const pull = await lifecyclePullRequestSnapshot(event.pull_request.number)
    await transitionResolvingIssues(pull, command)
  }
}

function readEvent() {
  if (!process.env.GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH 未设置')
  return JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
}

async function main(argv) {
  const [command] = argv
  if (command === 'pr') await runPullRequestCheck(readEvent())
  else if (command === 'issue') await runIssueCheck(readEvent())
  else if (command === 'lifecycle') await runLifecycle(process.env.GITHUB_EVENT_NAME, readEvent())
  else throw new Error('用法：policy.mjs pr|issue|lifecycle')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}