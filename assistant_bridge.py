"""Authenticated local CLI and stdio MCP bridge. Never prints credentials."""
import argparse, json, re, sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT=Path(__file__).resolve().parent
def request(path,body=None,raw=None,filename=None,binary=False):
    try: config=json.loads((ROOT/'data'/'connection.json').read_text(encoding='utf-8'))
    except FileNotFoundError: raise RuntimeError('Launch Hellfire Director from the desktop icon first.')
    if not re.fullmatch(r'http://127\.0\.0\.1:\d+',config['url']): raise ValueError('Only a loopback connection is allowed.')
    headers={'X-Director-Token':config['token']}
    if body is not None: raw=json.dumps(body).encode(); headers['Content-Type']='application/json'
    if filename:
        from urllib.parse import quote
        headers['X-Filename']=quote(filename)
    req=Request(config['url']+path,data=raw,headers=headers)
    try:
        with urlopen(req,timeout=180) as response: result=response.read()
    except HTTPError as e: raise RuntimeError(json.loads(e.read()).get('error',str(e)))
    return result if binary else json.loads(result)
def import_plan(content,project_id=None,new=False,choices=None,preview=False,expected=None):
    raw=content if isinstance(content,bytes) else json.dumps(content).encode()
    prep=request('/api/import/prepare',raw=raw,filename='assistant-input.json')
    if not new and not project_id: raise ValueError('A project ID is required for a merge.')
    if preview: return request('/api/import/review',dict(token=prep['token'],projectId=project_id))
    if expected is None and project_id: expected=request('/api/projects/'+project_id)['revision']
    return request('/api/import/apply',dict(token=prep['token'],projectId=project_id,mode='new' if new else 'merge',expectedRevision=expected,choices=choices or {}))
TOOLS=[
 dict(name='list_projects',description='List saved local music-video projects. App must be running.',inputSchema=dict(type='object',properties={})),
 dict(name='read_project',description='Read complete project and current revision before planning or editing.',inputSchema=dict(type='object',properties=dict(project_id=dict(type='string')),required=['project_id'])),
 dict(name='review_import',description='Preview a proposed assistant JSON import; does not edit a project. Notes and assignments stay unchanged by default.',inputSchema=dict(type='object',properties=dict(project_id=dict(type='string'),plan=dict(type='object')),required=['project_id','plan'])),
 dict(name='import_plan',description='Merge an authorized plan. Adds new IDs, preserves existing conflicting values unless a field path is explicitly accepted. Use review_import first. Always put proposals in assistantNotes.',inputSchema=dict(type='object',properties=dict(project_id=dict(type='string'),plan=dict(type='object'),expected_revision=dict(type='integer'),accepted_paths=dict(type='array',items=dict(type='string'))),required=['project_id','plan','expected_revision'])),
 dict(name='picture_audit',description='Read picture-use ledger and exact / suspected duplicate flags for this project only.',inputSchema=dict(type='object',properties=dict(project_id=dict(type='string')),required=['project_id']))
]
def call_tool(name,args):
    if name=='list_projects': return request('/api/projects')
    if name=='read_project': return request('/api/projects/'+args['project_id'])
    if name=='picture_audit': return request('/api/projects/'+args['project_id']+'/audit')
    if name in ('review_import','import_plan'):
        return import_plan(args['plan'],args['project_id'],choices={p:True for p in args.get('accepted_paths',[])},preview=name=='review_import',expected=args.get('expected_revision'))
    raise ValueError('Unknown tool')
def mcp():
    for line in sys.stdin:
        try:
            msg=json.loads(line); method=msg.get('method'); ident=msg.get('id')
            if ident is None: continue
            if method=='initialize': result=dict(protocolVersion='2024-11-05',capabilities=dict(tools=dict(listChanged=False)),serverInfo=dict(name='AI Music Video Timeline',version='1.0.0'),instructions='Read ASSISTANT.md. Keep user notes separate, respect locked decisions and do not reuse pictures. A loopback desktop app must be running.')
            elif method=='ping': result={}
            elif method=='tools/list': result=dict(tools=TOOLS)
            elif method=='tools/call':
                try: result=dict(content=[dict(type='text',text=json.dumps(call_tool(msg['params']['name'],msg['params'].get('arguments',{})),ensure_ascii=False))])
                except Exception as e: result=dict(isError=True,content=[dict(type='text',text=str(e))])
            else:
                print(json.dumps(dict(jsonrpc='2.0',id=ident,error=dict(code=-32601,message='Method not found'))),flush=True);continue
            print(json.dumps(dict(jsonrpc='2.0',id=ident,result=result)),flush=True)
        except Exception as e:
            print(json.dumps(dict(jsonrpc='2.0',id=None,error=dict(code=-32700,message=str(e)))),flush=True)
def main():
    parser=argparse.ArgumentParser(description=__doc__); sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('list'); sub.add_parser('mcp')
    for cmd in ('read','audit'):
        p=sub.add_parser(cmd);p.add_argument('project')
    p=sub.add_parser('import');p.add_argument('file');p.add_argument('--project');p.add_argument('--new',action='store_true');p.add_argument('--preview',action='store_true');p.add_argument('--accept',action='append',default=[]);p.add_argument('--expected-revision',type=int)
    p=sub.add_parser('export');p.add_argument('project');p.add_argument('output')
    args=parser.parse_args()
    if args.command=='mcp':return mcp()
    if args.command=='list': result=request('/api/projects')
    elif args.command=='read': result=request('/api/projects/'+args.project)
    elif args.command=='audit': result=request('/api/projects/'+args.project+'/audit')
    elif args.command=='import':
        result=import_plan(json.loads(Path(args.file).read_text(encoding='utf-8-sig')),args.project,args.new,{p:True for p in args.accept},args.preview,args.expected_revision)
    else:
        dest=Path(args.output);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(request('/api/projects/'+args.project+'/export',binary=True));result=dict(exported=str(dest.resolve()))
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
