# Regenerates every app icon / splash / store graphic from brand/logo-master.png.
# Usage: python3 tools/brand.py   (needs Pillow)
from PIL import Image, ImageDraw, ImageChops, ImageEnhance
src='brand/logo-master.png'
im=Image.open(src).convert('RGB'); BG=(10,8,7)
def keyed(crop, clear=()):
    r,g,b=crop.split(); mx=ImageChops.lighter(ImageChops.lighter(r,g),b)
    a=mx.point(lambda v: 0 if v<62 else (255 if v>110 else int((v-62)*255/48)))
    d=ImageDraw.Draw(a)
    for b in clear: d.rectangle(b,fill=0)
    out=crop.convert('RGBA'); out.putalpha(a); return out
lock=keyed(im.crop((196,186,1058,1048)), clear=[(0,0,160,100)])
mono=keyed(im.crop((262,196,1014,884)), clear=[(0,0,90,90)])
def put(c,l,p): c.paste(l,p,l)
c=Image.new('RGB',(1024,1024),BG); put(c,lock.resize((930,930),Image.LANCZOS),(47,40)); c.save('assets/icon.png')
c=Image.new('RGB',(1024,1024),BG); s=600/max(mono.size); M=mono.resize((int(mono.size[0]*s),int(mono.size[1]*s)),Image.LANCZOS); put(c,M,((1024-M.size[0])//2,(1024-M.size[1])//2)); c.save('assets/adaptive-icon.png')
c=Image.new('RGB',(1284,2778),BG); put(c,lock.resize((900,900),Image.LANCZOS),((1284-900)//2,(2778-900)//2-60)); c.save('assets/splash.png')
Image.open('assets/icon.png').resize((48,48),Image.LANCZOS).save('assets/favicon.png')
Image.open('assets/icon.png').resize((512,512),Image.LANCZOS).save('brand/play-icon-512.png')
fg=Image.new('RGB',(1024,500),BG); put(fg,lock.resize((440,440),Image.LANCZOS),(292,30)); fg.save('brand/play-feature-1024x500.png')
lock.save('brand/logo-lockup-transparent.png'); mono.save('brand/logo-monogram-transparent.png')
# In-app logo: the artwork's own rounded tile, transparent outside it.
from PIL import ImageFilter
tile=im.crop((92,90,1162,1160)).convert('RGBA')
m=Image.new('L',tile.size,0); ImageDraw.Draw(m).rounded_rectangle([4,4,tile.size[0]-5,tile.size[1]-5],radius=175,fill=255)
tile.putalpha(m.filter(ImageFilter.GaussianBlur(1.2)))
tile.resize((512,512),Image.LANCZOS).save('assets/logo.png'); tile.resize((1024,1024),Image.LANCZOS).save('brand/logo-tile-1024.png')
# Android status-bar icon: flat white silhouette of the monogram.
w=Image.new('RGBA',mono.size,(255,255,255,0)); w.putalpha(mono.split()[3]); w.thumbnail((84,84),Image.LANCZOS)
n=Image.new('RGBA',(96,96),(255,255,255,0)); n.paste(w,((96-w.size[0])//2,(96-w.size[1])//2),w); n.save('assets/notification-icon.png')
print('brand assets regenerated')
