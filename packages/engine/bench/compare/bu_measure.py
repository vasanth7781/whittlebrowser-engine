"""
Measure what browser-use sends to the model for one step on each page, using browser-use's own code:
BrowserSession -> get_browser_state_summary -> AgentMessagePrompt.get_user_message (the exact per-step
user message), plus the fixed per-call parts: system prompt and the AgentOutput action schema.
No LLM is called. Tokens: o200k_base.

usage: .venv/bin/python bu_measure.py <chromium-executable> <url> [<url> ...]   -> JSON on stdout
"""
import asyncio, json, sys, tempfile, logging, os

os.environ.setdefault('ANONYMIZED_TELEMETRY', 'false')
os.environ.setdefault('BROWSER_USE_LOGGING_LEVEL', 'error')
logging.disable(logging.CRITICAL)

import tiktoken
from browser_use import BrowserSession, BrowserProfile, Tools
from browser_use.agent.prompts import AgentMessagePrompt, SystemPrompt
from browser_use.agent.views import AgentOutput
from browser_use.filesystem.file_system import FileSystem

enc = tiktoken.get_encoding('o200k_base')
tok = lambda s: len(enc.encode(s))


def text_of(msg):
    c = msg.content
    if isinstance(c, str):
        return c
    return ''.join(getattr(p, 'text', '') or '' for p in c)


async def main(exe, urls):
    profile = BrowserProfile(executable_path=exe, headless=True, viewport={'width': 1280, 'height': 860}, user_data_dir=None, keep_alive=False)
    session = BrowserSession(browser_profile=profile)
    await session.start()
    fs = FileSystem(tempfile.mkdtemp())
    tools = Tools()
    schema = AgentOutput.type_with_custom_actions(tools.registry.create_action_model()).model_json_schema()
    system = SystemPrompt(max_actions_per_step=5).get_system_message().content
    out = {'system': tok(system), 'schema': tok(json.dumps(schema)), 'pages': []}
    for url in urls:
        try:
            try:
                await asyncio.wait_for(session.navigate_to(url), 40)
            except Exception:
                await asyncio.sleep(1.5)  # first navigation can race the session start-up
                await session.navigate_to(url)
            await asyncio.sleep(1.2)
            state = await asyncio.wait_for(session.get_browser_state_summary(include_screenshot=True), 60)
            prompt = AgentMessagePrompt(browser_state_summary=state, file_system=fs, task='(task)', screenshots=[state.screenshot] if state.screenshot else [])
            text = text_of(prompt.get_user_message(use_vision=False))
            # Vision is on by default; Claude bills images at about width*height/750 tokens.
            img = round(1280 * 860 / 750) if state.screenshot else 0
            row = {'url': url, 'state': tok(text), 'image': img}
            if 'canary' in url or 'injection' in url:
                row['text'] = text  # safety checks (planted secrets, hidden injections)
            out['pages'].append(row)
        except Exception as e:  # keep going on flaky live sites
            out['pages'].append({'url': url, 'error': str(e)[:200]})
    await session.kill()
    print(json.dumps(out))


asyncio.run(main(sys.argv[1], sys.argv[2:]))
