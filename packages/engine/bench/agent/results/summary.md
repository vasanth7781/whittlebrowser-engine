## haiku (OpenAI estimate priced as gpt-6-luna)

| arm | passed | mean tokens / run | vs Playwright MCP | mean tool calls | mean turns | mean cost (Claude list) | mean cost (OpenAI est.) | mean time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| WhittleBrowser | 21/21 | 28,161 | −47% | 5.8 | 6.8 | $0.0018 | $0.0013 | 13s |
| WhittleBrowser (before fix) | 21/21 | 39,043 | −27% | 6.8 | 7.8 | $0.0021 | $0.0015 | 15s |
| Playwright MCP | 21/21 | 53,371 | – | 6.1 | 7.1 | $0.0022 | $0.0016 | 16s |
| browser-use | 20/21 | 87,351 | +64% | 11.3 | 12.3 | $0.0047 | $0.0031 | 36s |
| Stagehand | 18/21 | 27,208 | −49% | 5.8 | 6.8 | $0.0024 | $0.0015 | 15s |

## sonnet (OpenAI estimate priced as gpt-6.1-sol)

| arm | passed | mean tokens / run | vs Playwright MCP | mean tool calls | mean turns | mean cost (Claude list) | mean cost (OpenAI est.) | mean time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| WhittleBrowser | 21/21 | 19,943 | −31% | 4.1 | 5.1 | $0.0207 | $0.0159 | 16s |
| WhittleBrowser (before fix) | 21/21 | 33,817 | +17% | 6.0 | 7.0 | $0.0309 | $0.0220 | 22s |
| Playwright MCP | 18/21 | 28,890 | – | 3.9 | 4.9 | $0.0169 | $0.0146 | 38s |
| browser-use | 21/21 | 36,022 | +25% | 7.2 | 8.2 | $0.0477 | $0.0309 | 28s |
| Stagehand | 21/21 | 25,005 | −13% | 6.2 | 7.2 | $0.0369 | $0.0255 | 24s |

## Pass rate and mean tokens per task (all models)

| task | WhittleBrowser | WhittleBrowser (before fix) | Playwright MCP | browser-use | Stagehand |
|---|---:|---:|---:|---:|---:|
| table | 6/6 · 24,637 | 6/6 · 25,182 | 5/6 · 20,921 | 6/6 · 26,566 | 6/6 · 14,899 |
| form | 6/6 · 19,600 | 6/6 · 19,641 | 6/6 · 46,132 | 6/6 · 147,439 | 6/6 · 17,770 |
| article | 6/6 · 12,975 | 6/6 · 11,386 | 6/6 · 24,716 | 6/6 · 13,846 | 6/6 · 9,702 |
| spa | 6/6 · 22,869 | 6/6 · 27,377 | 4/6 · 97,069 | 6/6 · 105,754 | 6/6 · 24,450 |
| books-cheapest | 6/6 · 30,306 | 6/6 · 23,907 | 6/6 · 27,192 | 6/6 · 33,342 | 6/6 · 26,051 |
| books-five-star | 6/6 · 39,195 | 6/6 · 127,869 | 6/6 · 31,966 | 6/6 · 54,004 | 3/6 · 73,337 |
| quotes-login | 6/6 · 18,781 | 6/6 · 19,649 | 6/6 · 39,919 | 5/6 · 50,854 | 6/6 · 16,537 |

## Cost of one pass over the battery (7 tasks)

| arm | haiku (Claude list) | sonnet (Claude list) | haiku → gpt-6-luna (est.) | sonnet → gpt-6.1-sol (est.) |
|---|---:|---:|---:|---:|
| WhittleBrowser | $0.0127 | $0.145 | $0.0090 | $0.112 |
| WhittleBrowser (before fix) | $0.0149 | $0.216 | $0.0104 | $0.154 |
| Playwright MCP | $0.0153 | $0.119 | $0.0110 | $0.102 |
| browser-use | $0.0332 | $0.334 | $0.0220 | $0.216 |
| Stagehand | $0.0170 | $0.259 | $0.0108 | $0.179 |
