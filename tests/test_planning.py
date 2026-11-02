import copy, csv, io, json, unittest, zipfile
from test_core import app

class PlanningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): app.initialize()
    def test_planning_export_and_restore_keeps_media_and_scene_cuts(self):
        p=app.blank('Planning package test')
        p.update(concept='A whole-video vision.\nKeep <script>literal</script> & accents: café.',storyboardText='SC001 00:00–00:04\n  Action, camera & music.\n\nSC002 — the reveal.',productionNotes='Keep the instrument solo.',lyricImportText='0:01 – 0:03 Singing')
        song=app.add_asset(b'isolated test audio','test-song.wav');p['assets']=[song];p['song']=song['id']
        p['scenes']=[dict(id='one',start=0,end=4,title='Opening',role='story',userNotes='Keep this exact cut.',media={})]
        p['lyrics']=[dict(id='lyric',start=1.125,end=3.5,text='=A lyric, with "quotes"\nand a second line',status='draft')]
        before=copy.deepcopy(p)
        saved=app.save_project(p,0,'Planning test');raw=app.export_zip(app.read_project(p['id'])['state'])
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            for file,key in [('video-vision.txt','concept'),('storyboard.txt','storyboardText'),('production-notes.txt','productionNotes')]:self.assertEqual(z.read(file).decode(),p[key])
            document=z.read('storyboard.html').decode();self.assertNotIn('<script>literal</script>',document);self.assertIn('&lt;script&gt;literal&lt;/script&gt;',document);self.assertIn('Timed lyrics',document)
            rows=list(csv.reader(io.StringIO(z.read('timed-lyrics.csv').decode('utf-8-sig'))));self.assertEqual(rows[1][:2],['00:01.125','00:03.500']);self.assertEqual(rows[1][2],"'"+p['lyrics'][0]['text'])
            self.assertEqual(json.loads(z.read('project.json')),p);self.assertIn('media/'+song['filename'],z.namelist())
        restored=app.decode_import(raw,'package.zip')
        if isinstance(restored,tuple):restored=restored[0]
        self.assertEqual(restored['storyboardText'],p['storyboardText']);self.assertEqual(restored['concept'],p['concept']);self.assertEqual(restored['scenes'],p['scenes']);self.assertEqual(restored['lyrics'],p['lyrics']);self.assertEqual(p,before)
    def test_older_project_exports_without_new_fields(self):
        p=app.blank();p.pop('storyboardText');p.pop('lyricImportText')
        with zipfile.ZipFile(io.BytesIO(app.export_zip(p))) as z:self.assertEqual(z.read('storyboard.txt'),b'')

if __name__=='__main__':unittest.main()
