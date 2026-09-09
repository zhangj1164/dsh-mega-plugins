
import pathlib
p = pathlib.Path('.github/issue-management/policy.mjs')
t = p.read_text(encoding='utf-8')
BT = chr(96)  # backtick
DS = chr(36)  # dollar sign
old = 'const issue = await api(' + BT + '/repos/' + DS + '{config.organization}/' + DS + '{config.repository}/issues/' + DS + '{number}' + BT + ')'
new = 'const issue = await api(' + BT + '/repos/' + DS + '{config.organization}/' + DS + '{config.repository}/issues/' + DS + '{number}' + BT + ', { allow404: true })'
assert old in t, 'old string not found: ' + repr(old[:60])
t = t.replace(old, new)
old2 = 'if (issue.pull_request) return null'
new2 = 'if (!issue || issue.pull_request) return null'
assert old2 in t, 'old2 string not found'
t = t.replace(old2, new2)
p.write_text(t, encoding='utf-8')
print('OK: patched successfully')
