"""챗봇 답변 캡처 6장(V_챗봇답변_01~06)을 이어 붙여 3편 스크롤용 띠(assets/chat_strip.jpg)와 위·아래 고정 영역(chat_head.png·chat_foot.png)을 만든다.
위 0~172px·아래 2666px~ 는 여섯 장 모두 같은 고정 영역(픽셀 비교로 확인). 1→2 는 겹치는 부분이 없어(맞춤 오차 13.2) 통째로 잇고,
나머지는 행 서명 맞춤으로 찾은 이동량(2389·2029·1995·2016px)만큼 새 부분만 잇는다."""
from PIL import Image
T, Bt = 172, 2666
offs = [Bt - T, 2389, 2029, 1995, 2016]
parts = [Image.open('assets/v01.jpg').crop((0, T, 1440, Bt))]
for k, d in enumerate(offs):
    parts.append(Image.open(f'assets/v0{k + 2}.jpg').crop((0, Bt - d, 1440, Bt)))
H = sum(p.height for p in parts); S = Image.new('RGB', (1440, H)); y = 0
for p in parts:
    S.paste(p, (0, y)); y += p.height
S.resize((400, round(H * 400 / 1440)), Image.LANCZOS).save('assets/chat_strip.jpg', quality=92)
v6 = Image.open('assets/v06.jpg')
v6.crop((0, 0, 1440, T)).resize((400, round(T * 400 / 1440)), Image.LANCZOS).save('assets/chat_head.png')
v6.crop((0, Bt, 1440, 2939)).resize((400, round((2939 - Bt) * 400 / 1440)), Image.LANCZOS).save('assets/chat_foot.png')
print('ok', S.size)
