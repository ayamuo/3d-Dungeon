# 昇降機のモデルを組み立てて、ゲームと同じカメラから描き出す（Blender 5.x、画面を出さずに実行）
#   blender -b --factory-startup -P elev.py -- <出力フォルダ> <モード>
#   モード: test（確認用に数枚・切り抜かない）/ all（全部・切り抜いて一覧も書き出す）
import bpy, sys, math, os, json
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "."
MODE = argv[1] if len(argv) > 1 else "test"
os.makedirs(OUT, exist_ok=True)

# ── ゲームの見え方（explore.js の P() と同じ）──
#   画面の横位置 = cx + x/z*K（K = 画面の幅×0.56）→ 横の画角 = 2*atan(0.5/0.56)
#   マスは1×1×1。目の高さは床(-0.5)と天井(+0.5)の真ん中。dd マス先のマスの中心は、奥行き dd+0.78
K = 0.56
FOV_X = 2 * math.atan(0.5 / K)
RES = (960, 600)
ZO = 0.28

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ── 材質 ──
def mat_iron(name, base, rust, rough=0.72, metal=0.55, bump=0.35, scale=22):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nodes = nt.nodes; links = nt.links
    bsdf = nodes.get("Principled BSDF")
    tc = nodes.new("ShaderNodeTexCoord"); mp = nodes.new("ShaderNodeMapping"); links.new(tc.outputs["Object"], mp.inputs["Vector"])
    noise = nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = scale; noise.inputs["Detail"].default_value = 10; noise.inputs["Roughness"].default_value = 0.7
    links.new(mp.outputs["Vector"], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.50; ramp.color_ramp.elements[0].color = (*base, 1)
    ramp.color_ramp.elements[1].position = 0.68; ramp.color_ramp.elements[1].color = (*rust, 1)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough; bsdf.inputs["Metallic"].default_value = metal
    n2 = nodes.new("ShaderNodeTexNoise"); n2.inputs["Scale"].default_value = scale * 5; n2.inputs["Detail"].default_value = 6
    links.new(mp.outputs["Vector"], n2.inputs["Vector"])
    rr = nodes.new("ShaderNodeMapRange"); rr.inputs["To Min"].default_value = max(0.25, rough - 0.3); rr.inputs["To Max"].default_value = min(1.0, rough + 0.15)
    links.new(noise.outputs["Fac"], rr.inputs["Value"]); links.new(rr.outputs["Result"], bsdf.inputs["Roughness"])
    bmp = nodes.new("ShaderNodeBump"); bmp.inputs["Strength"].default_value = bump
    links.new(n2.outputs["Fac"], bmp.inputs["Height"]); links.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    return m

def mat_plain(name, color, rough=0.9, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = strength
    return m

IRON = mat_iron("iron", (0.15, 0.15, 0.155), (0.30, 0.17, 0.09), rough=0.6, metal=0.8, bump=0.5, scale=26)
RUST = mat_iron("rust", (0.27, 0.14, 0.07), (0.44, 0.25, 0.11), rough=0.85, metal=0.4, bump=0.6, scale=34)
PLATE = mat_iron("plate", (0.11, 0.11, 0.115), (0.26, 0.16, 0.09), rough=0.5, metal=0.85, bump=0.8, scale=40)
DARK = mat_plain("dark", (0.004, 0.004, 0.006), rough=1.0)
ROPE = mat_plain("rope", (0.06, 0.055, 0.05), rough=0.8, metal=0.4)
LAMP = mat_plain("lamp", (1.0, 0.6, 0.2), emit=(1.0, 0.42, 0.08), strength=2.2)
KNOB = mat_plain("knob", (0.55, 0.05, 0.04), rough=0.45)

# ── 部品を置く道具（モデルの座標：X＝横、Y＝入口(−)から奥の戸(＋)、Z＝高さ。床 −0.5 / 天井 +0.5）──
root = bpy.data.objects.new("elev", None); scene.collection.objects.link(root)
def box(x0, x1, y0, y1, z0, z1, mat, bevel=0.004):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.object; o.scale = (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)  # 大きさを確定（模様が引き伸ばされないように）
    o.data.materials.append(mat); o.parent = root
    if bevel:
        bv = o.modifiers.new("b", "BEVEL"); bv.width = bevel; bv.segments = 2
    return o
def bar(p0, p1, r, mat):
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=r, depth=d.length, location=(p0 + p1) / 2)
    o = bpy.context.object; o.rotation_mode = "QUATERNION"; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    o.data.materials.append(mat); o.parent = root
    return o

HW = 0.42          # かごの半分の幅・奥行き
TOP = 0.40         # かごの天井の枠の高さ
FL = -0.5
P = 0.05           # 柱の太さ

# 床（縞鋼板）と縁
box(-HW, HW, -HW, HW, FL, FL + 0.025, PLATE)
for i in range(7):   # 滑り止めの筋
    y = -HW + 0.08 + i * 0.115
    box(-HW + 0.06, HW - 0.06, y, y + 0.012, FL + 0.025, FL + 0.032, PLATE, bevel=0)
# 四隅の柱
for sx in (-1, 1):
    for sy in (-1, 1):
        x0 = sx * HW - (P if sx > 0 else 0); y0 = sy * HW - (P if sy > 0 else 0)
        box(x0, x0 + P, y0, y0 + P, FL, TOP, IRON)
# 天井の枠と、吊り索を受ける梁
box(-HW, HW, -HW, -HW + P, TOP, TOP + 0.05, IRON); box(-HW, HW, HW - P, HW, TOP, TOP + 0.05, IRON)
box(-HW, -HW + P, -HW, HW, TOP, TOP + 0.05, IRON); box(HW - P, HW, -HW, HW, TOP, TOP + 0.05, IRON)
box(-HW, HW, -0.035, 0.035, TOP, TOP + 0.05, IRON)
box(-0.035, 0.035, -HW, HW, TOP + 0.005, TOP + 0.045, IRON)
# 左右の柵（腰の高さまでの斜め格子と手すり）
RAIL = 0.05
for sx in (-1, 1):
    x = sx * (HW - P / 2)
    box(x - 0.012, x + 0.012, -HW + P, HW - P, RAIL - 0.02, RAIL + 0.01, IRON)
    box(x - 0.010, x + 0.010, -HW + P, HW - P, FL + 0.03, FL + 0.055, IRON)
    n = 4; span = (2 * HW - 2 * P) / n
    for i in range(n):
        ya = -HW + P + i * span; yb = ya + span
        bar((x, ya, FL + 0.05), (x, yb, RAIL - 0.01), 0.0075, IRON)
        bar((x, yb, FL + 0.05), (x, ya, RAIL - 0.01), 0.0075, IRON)
# 奥の蛇腹の格子戸（床から天井の枠まで）と、その向こうの縦穴の闇
yg = HW - P / 2
n = 6; span = (2 * HW - 2 * P) / n
for i in range(n):
    xa = -HW + P + i * span; xb = xa + span
    bar((xa, yg, FL + 0.03), (xb, yg, TOP), 0.007, RUST)
    bar((xb, yg, FL + 0.03), (xa, yg, TOP), 0.007, RUST)
for i in range(n + 1):
    xa = -HW + P + i * span
    bar((xa, yg, FL + 0.03), (xa, yg, TOP), 0.006, RUST)
box(-HW + P, HW - P, yg + 0.02, yg + 0.024, FL + 0.03, TOP, DARK, bevel=0)
# 吊り索と滑車、天井の穴
for sx in (-0.05, 0.05):
    bar((sx, 0, TOP + 0.05), (sx, 0, 0.5), 0.008, ROPE)
box(-0.09, 0.09, -0.03, 0.03, TOP + 0.05, TOP + 0.085, IRON)
box(-0.17, 0.17, -0.17, 0.17, 0.497, 0.4995, DARK, bevel=0)
# 入口のそばの操作レバー（右手前）
box(0.25, 0.33, -HW + 0.06, -HW + 0.12, FL + 0.025, -0.22, IRON)
bar((0.29, -HW + 0.09, -0.22), (0.23, -HW + 0.09, -0.02), 0.009, IRON)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.022, location=(0.23, -HW + 0.09, -0.02)); o = bpy.context.object; o.data.materials.append(KNOB); o.parent = root; bpy.ops.object.shade_smooth()
# 片隅のランタン（左手前の柱から吊るす）
lx, ly, lz = -HW + 0.12, -HW + 0.12, 0.12
bar((lx, ly, TOP), (lx, ly, lz + 0.055), 0.004, ROPE)
box(lx - 0.03, lx + 0.03, ly - 0.03, ly + 0.03, lz + 0.04, lz + 0.055, IRON, bevel=0.003)
box(lx - 0.03, lx + 0.03, ly - 0.03, ly + 0.03, lz - 0.055, lz - 0.04, IRON, bevel=0.003)
box(lx - 0.027, lx + 0.027, ly - 0.027, ly + 0.027, lz - 0.04, lz + 0.04, LAMP, bevel=0.003)
ld = bpy.data.lights.new("lantern", "POINT"); ld.energy = 14.0; ld.color = (1.0, 0.62, 0.3); ld.shadow_soft_size = 0.03
lo = bpy.data.objects.new("lantern", ld); lo.location = (lx, ly, lz); lo.parent = root; scene.collection.objects.link(lo)

# ── カメラと明かり（明るさは均一に。距離で暗くするのはゲーム側）──
cam_d = bpy.data.cameras.new("cam"); cam_d.sensor_fit = "HORIZONTAL"; cam_d.angle_x = FOV_X; cam_d.clip_start = 0.02; cam_d.clip_end = 50
cam = bpy.data.objects.new("cam", cam_d); cam.rotation_euler = (math.radians(90), 0, 0); scene.collection.objects.link(cam); scene.camera = cam
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes.get("Background"); bg.inputs["Color"].default_value = (0.55, 0.57, 0.65, 1); bg.inputs["Strength"].default_value = 0.22
td = bpy.data.lights.new("key", "SUN"); td.energy = 3.2; td.color = (1.0, 0.93, 0.82); td.angle = math.radians(12)
to = bpy.data.objects.new("key", td); to.rotation_euler = (math.radians(58), 0, math.radians(-32)); scene.collection.objects.link(to)
fd = bpy.data.lights.new("fill", "SUN"); fd.energy = 0.7; fd.color = (0.75, 0.82, 1.0)
fo = bpy.data.objects.new("fill", fd); fo.rotation_euler = (math.radians(75), 0, math.radians(55)); scene.collection.objects.link(fo)

scene.render.resolution_x, scene.render.resolution_y = RES; scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGBA"
ENGINE = None
for e in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
    try:
        scene.render.engine = e; ENGINE = e; break
    except Exception:
        pass
if ENGINE == "CYCLES":
    scene.cycles.samples = 48; scene.cycles.use_denoising = True
try:
    scene.view_settings.view_transform = "Standard"
except Exception:
    pass
print("ENGINE", ENGINE)

# ── 置く位置と向き：dd＝何マス先 / l＝横に何マス（右が＋）/ rel＝向き（0 奥・1 右・2 手前・3 左）──
def place(dd, l, rel):
    root.location = (l, dd + ZO + 0.5, 0)
    root.rotation_euler = (0, 0, -rel * math.pi / 2)

def render(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

if MODE == "test":
    for dd, l, rel in [(1, 0, 0), (1, 0, 1), (2, 0, 0), (1, 1, 0), (2, -1, 3), (1, 0, 2)]:
        place(dd, l, rel); render(os.path.join(OUT, f"t_d{dd}_l{l}_r{rel}.png"))
else:
    import numpy as np
    man = {"w": RES[0], "h": RES[1], "items": {}}
    for dd in (1, 2, 3, 4):
        for l in (-3, -2, -1, 0, 1, 2, 3):
            for rel in (0, 1, 2, 3):
                place(dd, l, rel)
                tmp = os.path.join(OUT, "_tmp.png"); render(tmp)
                img = bpy.data.images.load(tmp, check_existing=False)
                w, h = img.size; px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
                ys, xs = np.where(px[:, :, 3] > 0.01)
                bpy.data.images.remove(img)
                if len(xs) < 40:
                    continue
                x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
                crop = px[y0:y1, x0:x1, :]
                name = f"elev_d{dd}_l{l}_r{rel}.png"
                out = bpy.data.images.new("c", x1 - x0, y1 - y0, alpha=True)
                out.pixels.foreach_set(crop.reshape(-1)); out.filepath_raw = os.path.join(OUT, name); out.file_format = "PNG"; out.save(); bpy.data.images.remove(out)
                # 画像は下が原点。画面の上からの位置に直して記録する
                man["items"][f"{dd},{l},{rel}"] = [name, x0, h - y1, x1 - x0, y1 - y0]
    if os.path.exists(os.path.join(OUT, "_tmp.png")): os.remove(os.path.join(OUT, "_tmp.png"))
    with open(os.path.join(OUT, "elev.json"), "w") as f: json.dump(man, f)
    print("DONE", len(man["items"]))
