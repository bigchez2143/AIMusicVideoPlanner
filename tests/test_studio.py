import copy, io, json, unittest, zipfile
from test_core import app
from studio_support import remap_studio_assets

class StudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): app.initialize()
    def fixture(self):
        p=app.blank('Directing desk test')
        p['scenes']=[dict(id='s',title='Handoff',start=0,end=6,media={},studio=dict(camera=dict(performers=[dict(id='p',name='Georgia Belle',x=30,y=40)],points=[dict(id='c',time=0,x=10,y=80,target='p')]),takes=[dict(id='take',assetId='old',sha256='abc',status='accepted',startOffset=1)]))]
        p['studio']=dict(music=dict(bpm=120,offset=.25,cues=[dict(id='cue',time=1,type='accent',label='Hit')],energy=[dict(id='energy',time=2,energy=5,label='Peak')]),continuityCards=[dict(id='card',name='Ruby tattoo',assetId='old',status='accepted')],cutVersions=[dict(id='cut',assetId='old',label='v1',sha256='abc',offset=0,sceneMap=[dict(id='s',title='Handoff',start=0,end=6)])],reviewNotes=[dict(id='note',versionId='cut',assetId='old',sha256='abc',time=2,endTime=3,text='<script>alert(1)</script>',status='open',annotations=[dict(x=.5,y=.5,rx=.2,ry=.1)])],lookbook=[dict(id='book',title='Useful shot',assetId='old',lesson='Preserve this movement')],budgets=[dict(id='budget',provider='Kling',ceiling=100,balance=200,approval='not approved')])
        return p
    def test_save_export_import_all_planning_data(self):
        p=self.fixture();saved=app.save_project(p,0)
        raw=app.export_zip(saved['state'])
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            self.assertIn('directing-desk.html',z.namelist());self.assertIn('review-notes.csv',z.namelist())
            html=z.read('directing-desk.html').decode();self.assertIn('<svg',html);self.assertNotIn('<script>alert',html);self.assertIn('&lt;script&gt;',html)
            self.assertEqual(json.loads(z.read('project.json'))['studio'],p['studio'])
        incoming=app.decode_import(raw,'package.zip');self.assertEqual(incoming['studio'],p['studio']);self.assertEqual(incoming['scenes'],p['scenes'])
    def test_media_bindings_remap_every_review_and_reference(self):
        p=self.fixture();remap_studio_assets(p,{'old':'new'})
        for key in ('continuityCards','cutVersions','reviewNotes','lookbook'):self.assertEqual(p['studio'][key][0]['assetId'],'new')
        self.assertEqual(p['scenes'][0]['studio']['takes'][0]['assetId'],'new');self.assertEqual(p['studio']['reviewNotes'][0]['sha256'],'abc')
    def test_review_scene_map_survives_timeline_edits(self):
        p=self.fixture();p['scenes'][0]['start']=2
        self.assertEqual(p['studio']['cutVersions'][0]['sceneMap'][0]['start'],0)
    def test_import_preserves_notes_until_explicit_choice(self):
        p=self.fixture();incoming=copy.deepcopy(p);incoming['studio']['reviewNotes'][0]['text']='Replace?'
        merged,changes=app.merge_with_review(p,incoming)
        self.assertEqual(merged['studio']['reviewNotes'][0]['text'],p['studio']['reviewNotes'][0]['text']);self.assertIn('/studio/reviewNotes/note/text',[c['path'] for c in changes])
    def test_bad_coordinates_and_duplicate_ids_rejected(self):
        p=self.fixture();p['scenes'][0]['studio']['camera']['points'][0]['x']=101
        with self.assertRaises(ValueError):app.validate(p)
        p=self.fixture();p['studio']['reviewNotes'][0]['annotations'][0]['rx']=float('nan')
        with self.assertRaises(ValueError):app.validate(p)
        p=self.fixture();p['studio']['budgets']*=2
        with self.assertRaises(ValueError):app.validate(p)
    def test_legacy_project_without_studio_still_works(self):
        p=app.blank('Legacy');app.validate(p);app.export_zip(p);self.assertNotIn('studio',p)
