import copy, importlib.util, io, json, os, sqlite3, sys, tempfile, threading, unittest, zipfile
from unittest.mock import Mock, patch
from types import SimpleNamespace
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
TEMP=tempfile.TemporaryDirectory()
os.environ['DIRECTOR_DATA']=TEMP.name
spec=importlib.util.spec_from_file_location('director',ROOT/'server.py'); app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)

class CoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):app.initialize()
    def setUp(self):
        self.project=app.blank('Synthetic test project')
        self.project['scenes']=[dict(id='scene-a',title='Opening',start=0,end=8,userNotes='Keep my exact note.',assistantNotes='Proposed beat',performers=[dict(name='Georgia Belle',instrument='guitar')],media={},role='story')]
    def test_version_conflicts_and_history(self):
        a=app.save_project(self.project,0,'Created');self.assertEqual(a['revision'],1)
        self.project['title']='Changed';b=app.save_project(self.project,1,'Manual save');self.assertEqual(b['revision'],2)
        with self.assertRaises(app.Conflict):app.save_project(self.project,1)
        with app.connection() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM versions WHERE project_id=?',(self.project['id'],)).fetchone()[0],2)
        self.assertTrue((app.DATA/'backups'/self.project['id']/'000002.json').is_file())
    def test_import_keeps_user_notes_and_unknown_fields(self):
        self.project['futureExtension']={'color':'red'}
        incoming={'scenes':[dict(id='scene-a',start=0,end=9,userNotes='Overwritten?',assistantNotes='New proposal',performers=[]),dict(id='scene-b',start=9,end=14,title='Added')],'futureExtension':{'new':42}}
        merged,changes=app.merge_with_review(self.project,incoming)
        self.assertEqual(merged['scenes'][0]['userNotes'],'Keep my exact note.')
        self.assertEqual(merged['scenes'][0]['performers'][0]['instrument'],'guitar')
        self.assertEqual(len(merged['scenes']),2);self.assertEqual(merged['futureExtension'],{'color':'red','new':42})
        merged,_=app.merge_with_review(self.project,incoming,{'/scenes/scene-a/end':True,'/scenes/scene-a/assistantNotes':True})
        self.assertEqual(merged['scenes'][0]['end'],9);self.assertEqual(merged['scenes'][0]['assistantNotes'],'New proposal')
    def test_reject_invalid_timing_and_duplicate_ids(self):
        p=copy.deepcopy(self.project);p['scenes'][0]['end']=0
        with self.assertRaises(ValueError):app.validate(p)
        p=copy.deepcopy(self.project);p['scenes'].append(copy.deepcopy(p['scenes'][0]))
        with self.assertRaises(ValueError):app.validate(p)
    def picture(self):
        out=io.BytesIO();Image.new('RGB',(20,20),(27,45,78)).save(out,format='PNG');return out.getvalue()
    def test_reuse_ledger_and_specific_exception(self):
        raw=self.picture();a=app.add_asset(raw,'first.png');b=app.add_asset(raw,'renamed.png');self.assertEqual(a['id'],b['id'])
        self.project['assets']=[a];self.project['scenes'][0]['media']={'begin':a['id']}
        self.project['scenes'].append(dict(id='scene-b',start=8,end=16,media={'begin':b['id']}))
        audit=app.audit(self.project);self.assertTrue(any(x['type']=='repeat' for x in audit['issues']));self.assertEqual(len(audit['ledger']),2)
        self.project['reuseExceptions']=[dict(scenes=['scene-a','scene-b'],assets=[a['id'],a['id']],reason='Explicit synthetic test exception')]
        self.assertFalse(any(x['type']=='repeat' for x in app.audit(self.project)['issues']))
    def test_zip_round_trip_preserves_media_notes_assignments(self):
        a=app.add_asset(self.picture(),'source.png');self.project['assets']=[a];self.project['scenes'][0]['media']={'begin':a['id']}
        self.project['future']={'custom':'preserved'}
        raw=app.export_zip(self.project)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            for f in ['project.json','storyboard.html','scenes.csv','picture-use-ledger.json','media/'+a['filename']]:self.assertIn(f,z.namelist())
            self.assertIn('Keep my exact note.',z.read('storyboard.html').decode())
        p=app.decode_import(raw,'project.zip');self.assertEqual(p['scenes'],self.project['scenes']);self.assertEqual(p['future'],self.project['future'])
    def test_transformed_alias_content_group(self):
        a=app.add_asset(self.picture(),'source.png');b={**a,'id':'different-id','sha256':'different-bytes','dhash':None}
        self.project['assets']=[a,b];self.project['scenes'][0]['media']={'begin':a['id']};self.project['scenes'].append(dict(id='scene-b',start=8,end=16,media={'begin':b['id']}))
        self.assertTrue(any(x['type']=='repeat' for x in app.audit(self.project)['issues']))
    def test_csv_export_neutralizes_formula_cells(self):
        self.project['scenes'][0]['userNotes']='=1+1'
        raw=app.export_zip(self.project)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:self.assertIn("'=1+1",z.read('scenes.csv').decode('utf-8-sig'))
    def test_empty_import_does_not_erase_assignments(self):
        merged,_=app.merge_with_review(self.project,{'scenes':[],'lyrics':[]})
        self.assertEqual(merged['scenes'],self.project['scenes'])
    def test_transcription_forces_english_and_transcribe_task(self):
        engine=Mock()
        engine.transcribe.return_value=(iter([SimpleNamespace(start=0,end=2,text=' English lyrics ',words=[]),SimpleNamespace(start=2,end=2,text='invalid zero length',words=[])]),SimpleNamespace(duration=2,language='en'))
        model=Mock(return_value=engine)
        app.TRANSCRIPTIONS['english-test']={}
        with patch.dict(sys.modules,{'faster_whisper':SimpleNamespace(WhisperModel=model)}),patch.object(app,'asset_by_id',return_value={'filename':'test.wav'}):
            app.transcribe_task('english-test','fake-audio','small')
        options=engine.transcribe.call_args.kwargs
        self.assertEqual(options['language'],'en');self.assertEqual(options['task'],'transcribe')
        result=app.TRANSCRIPTIONS['english-test'];self.assertEqual(result['status'],'complete');self.assertEqual(result['language'],'en');self.assertEqual(len(result['lyrics']),1)
    def test_explicit_auto_language_remains_available(self):
        engine=Mock();engine.transcribe.return_value=(iter([]),SimpleNamespace(duration=2,language='fr'))
        app.TRANSCRIPTIONS['auto-test']={}
        with patch.dict(sys.modules,{'faster_whisper':SimpleNamespace(WhisperModel=Mock(return_value=engine))}),patch.object(app,'asset_by_id',return_value={'filename':'test.wav'}):
            app.transcribe_task('auto-test','fake-audio','small','auto')
        self.assertIsNone(engine.transcribe.call_args.kwargs['language'])
        self.assertEqual(app.TRANSCRIPTIONS['auto-test']['language'],'fr')
    def test_http_requires_auth_and_rejects_cross_origin(self):
        server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url='http://127.0.0.1:'+str(server.server_port)
        try:
            with urlopen(url+'/lyrics-core.js') as r:
                self.assertEqual(r.status,200);self.assertIn(b'LyricsCore',r.read())
            with self.assertRaises(HTTPError) as c:urlopen(url+'/api/projects')
            self.assertEqual(c.exception.code,403)
            with urlopen(Request(url+'/api/projects',headers={'X-Director-Token':app.TOKEN})) as r:self.assertEqual(r.status,200)
            with self.assertRaises(HTTPError) as c:urlopen(Request(url+'/api/projects',headers={'X-Director-Token':app.TOKEN,'Origin':'https://foreign.invalid'}))
            self.assertEqual(c.exception.code,403)
        finally:server.shutdown();server.server_close()

if __name__=='__main__':unittest.main()
