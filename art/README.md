# 素材目录

把出好的图放进这个目录，文件名按下表。**统一透明背景 PNG**，深/浅色两套底色由
CSS 适配，不需要出两版。

| 文件名 | 建议尺寸 | 用途 | 状态 |
|---|---|---|---|
| `hero.png` | **横版 2.2:1，腰以上** | 新会话首页 Hero 主视觉 | ⚠️ 已接入竖版全身像（1141×1379）；建议按下方提示词重出一版横版 |
| `mark.png` | 正方形，两人头肩 | 侧边栏 logo | ✅ 已接入（1254×1254 → 裁切 128×121） |
| `wordmark.png` | 1200×260 | 可选。侧边栏品牌字（当前是 CSS 渐变文字 `MIKU`） | ⬜ 可选 |
| `bg-aurora.png` | 2400×1600 | 可选。舞台光背景（当前是纯 CSS 极光） | ⬜ 可选 |

`samples/` 里是流程验证用的占位图，可以删。

已有的 `preview-ui.png` 是「配色 + 舞台光」的界面模拟，`preview-palette.html` 是
深浅两套 token 对照，都可对照参考。

### 重新出图后要做什么

```bash
~/…/plugins/miku-theme/tools/build-art.mjs        # 重新内联
```

如果新图的构图变了，**`mark` 的裁切框需要重新量**（在 `tools/build-art.mjs` 的
`ASSETS` 里）。当前框 `{ left: 60, top: 210, width: 1100, height: 1044 }` 是按
源图不透明区域 `x 0..1253, y 92..1187` 定的——目的是把两张脸框紧，这样在 24px
时青绿/靛蓝两块颜色仍然分得开。量法：

```bash
node -e "
const sharp = require('$DSH_PROFILE_DIR/node_modules/sharp')
sharp('art/mark.png').ensureAlpha().raw().toBuffer({resolveWithObject:true}).then(({data,info}) => {
  const {width,height,channels} = info
  let minX=width,minY=height,maxX=0,maxY=0
  for (let y=0;y<height;y++) for (let x=0;x<width;x++)
    if (data[(y*width+x)*channels+3] > 8) { if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y }
  console.log('content box:', minX+'..'+maxX, minY+'..'+maxY)
})
"
```

---

## 出图提示词

### `hero.png` — 要**横版**，腰以上构图

这个槽位按高度摆放（当前绘制 128px 高），宽度完全由图片自身比例决定。竖版图在
这里只有 110px 宽，两个人在里面缩成一点点；横版 2.2:1 能占到约 280px 宽，脸的
辨识度完全不是一个量级。**不要出全身像**——在 128px 的高度里，全身等于每个人
只有 128px 高，脸会糊掉。

```
anime illustration, LANDSCAPE 2.2:1 aspect ratio banner, two chibi girls side by side,
WAIST-UP composition (heads and torsos, not full body), friendly and warm,
both faces clearly visible and large in frame, tight framing with almost no empty
margin at the top or bottom

LEFT — Hatsune Miku: teal twin-tails framing her face, cyan-to-deep-teal hair gradient,
magenta ribbon ties, headset with a small mic, black sleeveless top with teal trim,
one hand raised in a small wave, cheerful open smile, teal eyes

RIGHT — a cute whale-girl mascot: deep indigo-blue hair with a small white-and-teal
whale tail crest on top of her head, white frilled maid headdress, navy maid dress
with a white apron, a whale tail visible curving out to the right, gentle smile,
one hand holding Miku's hand

palette: #39c5cf teal, #e12885 magenta, #1a9aa5 deep teal, #3752c9 indigo, #eaf7fb near-white
style: clean flat vector anime, soft cel shading, thick confident outlines,
no gradients on the line art, bright and friendly, sticker-like
background: fully transparent, no scenery, no ground shadow
```

> 已生成过一版竖版全身像（1141×1379），能用但偏窄；上面这版是让这个槽位真正
> 合格的出图方向。

### `mark.png`

```
anime chibi icon, head-and-shoulders bust of two girls leaning together, tightly
composed inside a square with a small margin

LEFT — Hatsune Miku: teal twin-tails framing the face, magenta hair ties, headset
RIGHT — whale-girl mascot: deep indigo-blue hair, small white-and-teal whale tail
crest on top of her head, whale hood

palette: #39c5cf teal, #e12885 magenta, #3752c9 indigo, #eaf7fb near-white
style: flat vector anime, thick clean outlines, high contrast so it survives at 24px,
centered, symmetrical-ish, transparent background, no text
```

### `bg-aurora.png`（可选）

```
abstract stage lighting backdrop, no characters, no text
large soft teal and magenta light pools sweeping across a deep near-black field,
faint horizontal scan lines, gentle grain, lots of empty dark space in the middle,
palette: #39c5cf, #e12885, #0a141a
style: minimal, cinematic, very low contrast so UI text stays readable on top,
seamless horizon, 3:2, transparent-to-dark, no lens flare
```

---

## 我会怎么用这些图

- `mark.png`：导出 24/28/34px 三档，侧边栏 logo 位与折叠态轨道共用；浅色模式下
  加一层轻微描边保证在浅底上不糊。
- `hero.png`：首页 Hero 主视觉，替换现在会摆尾的鲸鱼；两人头发/鲸尾加持续摆动
  （`prefers-reduced-motion` 下静止）。
- `wordmark.png`：侧边栏品牌字，替换当前 `MIKU 初音未来` 渐变文字。
- `bg-aurora.png`：替换 `body[data-dsh-miku-bg]::before` 的纯 CSS 极光。
