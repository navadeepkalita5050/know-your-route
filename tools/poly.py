import math
def decode(s,prec=5):
    idx=lat=lng=0; out=[]; f=10**prec
    while idx<len(s):
        for which in (0,1):
            shift=res=0
            while True:
                b=ord(s[idx])-63; idx+=1; res|=(b&0x1f)<<shift; shift+=5
                if b<0x20: break
            d=~(res>>1) if res&1 else res>>1
            if which==0: lat+=d
            else: lng+=d
        out.append((lng/f,lat/f))
    return out
def hk(a,b):
    t=math.radians; h=math.sin(t(b[1]-a[1])/2)**2+math.cos(t(a[1]))*math.cos(t(b[1]))*math.sin(t(b[0]-a[0])/2)**2
    return 12742*math.asin(math.sqrt(h))
