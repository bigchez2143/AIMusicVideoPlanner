from pathlib import Path
from PIL import Image, ImageDraw
p=Path(__file__).resolve().parent/'web'/'director.ico'
im=Image.new('RGBA',(256,256),(0,0,0,0)); d=ImageDraw.Draw(im)
d.rounded_rectangle((4,4,252,252),radius=55,fill='#ef956f')
d.rounded_rectangle((49,84,208,206),radius=16,fill='#191c22')
d.polygon([(49,69),(193,38),(207,76),(59,108)],fill='#191c22')
for x in (70,116,162):d.polygon([(x,65),(x+22,60),(x+2,94),(x-20,99)],fill='#ef956f')
d.polygon([(109,119),(109,178),(160,148)],fill='#ef956f')
im.save(p,sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('Created desktop icon.')
