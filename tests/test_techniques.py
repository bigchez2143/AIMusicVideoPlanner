import copy, csv, io, json, unittest, zipfile
from test_core import app


class TechniqueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): app.initialize()

    def fixture(self):
        p=app.blank('Technique round trip')
        p['direction'].update(director='Director & reference',directorStyle='Continuous performance with warm practicals')
        p['scenes']=[dict(id='shot-a',title='A shared performance',start=0,end=12,userNotes='Keep this exact note.',media={},
            techniques=[dict(id='choice-a',techniqueId='continuous-reframe',category='camera',title='Continuous reframing',description='Move between performers <without a cut>.',directions='=Start with Georgia Belle\nTravel to Ruby, then return.',future={'preserve':True})],
            shotPlan={'start':'Georgia Belle foreground','middle':'Ruby featured','end':'Georgia Belle continuing','timing':'Return on the chorus','continuity':'Keep amber light stage left','future':'retained'})]
        return p

    def test_save_export_import_preserves_techniques_director_and_existing_scene(self):
        p=self.fixture();before=copy.deepcopy(p)
        app.save_project(p,0,'Technique plan')
        stored=app.read_project(p['id'])['state'];self.assertEqual(stored,p)
        raw=app.export_zip(stored)
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            self.assertEqual(json.loads(z.read('project.json')),p)
            html=z.read('storyboard.html').decode()
            self.assertIn('Camera, lighting &amp; color',html)
            self.assertIn('Move between performers &lt;without a cut&gt;.',html)
            self.assertNotIn('<without a cut>',html)
            self.assertIn('Ruby featured',html)
            txt=z.read('scene-techniques.txt').decode()
            self.assertIn('Director / reference: Director & reference',txt)
            self.assertIn(p['scenes'][0]['techniques'][0]['directions'],txt)
            row=list(csv.DictReader(io.StringIO(z.read('scenes.csv').decode('utf-8-sig'))))[0]
            self.assertEqual(row['middleView'],'Ruby featured');self.assertIn('Continuous reframing',row['techniques'])
        restored=app.decode_import(raw,'techniques.zip')
        if isinstance(restored,tuple):restored=restored[0]
        self.assertEqual(restored,p);self.assertEqual(p,before)

    def test_import_keeps_existing_technique_directions_until_explicit_accept(self):
        p=self.fixture();incoming=copy.deepcopy(p)
        incoming['scenes'][0]['techniques'][0]['directions']='Different proposed route'
        incoming['direction']['director']='Different director'
        merged,changes=app.merge_with_review(p,incoming)
        self.assertEqual(merged,p)
        paths={c['path'] for c in changes}
        self.assertIn('/scenes/shot-a/techniques/choice-a/directions',paths)
        self.assertIn('/direction/director',paths)

    def test_older_scenes_export_without_added_data(self):
        p=app.blank();p['direction'].pop('director',None)
        p['scenes']=[dict(id='legacy',title='Existing scene',start=0,end=4)]
        before=copy.deepcopy(p)
        with zipfile.ZipFile(io.BytesIO(app.export_zip(p))) as z:
            self.assertIn('No scene techniques selected yet.',z.read('scene-techniques.txt').decode())
        self.assertEqual(p,before)

    def test_invalid_technique_fields_are_rejected(self):
        for key,value in [('techniques','bad'),('shotPlan',[]),('techniques',[{'id':'x','description':{}}])]:
            p=self.fixture();p['scenes'][0][key]=value
            with self.assertRaises(ValueError):app.validate(p)

    def test_route_csv_neutralizes_formula(self):
        p=self.fixture();p['scenes'][0]['shotPlan']['start']='=SUM(1,2)'
        with zipfile.ZipFile(io.BytesIO(app.export_zip(p))) as z:
            row=list(csv.DictReader(io.StringIO(z.read('scenes.csv').decode('utf-8-sig'))))[0]
            self.assertEqual(row['beginningView'],"'=SUM(1,2)")

if __name__=='__main__':unittest.main()
