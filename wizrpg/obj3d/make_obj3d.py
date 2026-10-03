# 迷宮に置く立体物（昇降機・上り階段・下り階段）のモデルを組み立てて、ゲームと同じカメラから描き出す。
# Blender 5.x を、画面を出さずに実行する：
#   blender -b --factory-startup -P make_obj3d.py -- <出力フォルダ> <種類: elev / up / down> <モード: test / all>
#   test＝確認用に数枚（切り抜かない）  all＝必要な位置と向きを全部（切り抜いて、位置の一覧 <種類>.json も書き出す）
import bpy, sys, math, os, json
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "."
KIND = argv[1] if len(argv) > 1 else "elev"
MODE = argv[2] if len(argv) > 2 else "test"
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
def mat_rough(name, base, alt, rough=0.72, metal=0.55, bump=0.35, scale=22):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nodes = nt.nodes; links = nt.links
    bsdf = nodes.get("Principled BSDF")
    tc = nodes.new("ShaderNodeTexCoord"); mp = nodes.new("ShaderNodeMapping"); links.new(tc.outputs["Object"], mp.inputs["Vector"])
    noise = nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = scale; noise.inputs["Detail"].default_value = 10; noise.inputs["Roughness"].default_value = 0.7
    links.new(mp.outputs["Vector"], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.50; ramp.color_ramp.elements[0].color = (*base, 1)
    ramp.color_ramp.elements[1].position = 0.68; ramp.color_ramp.elements[1].color = (*alt, 1)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"]); links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = metal
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

def mat_shaft(name, color, z_near, z_far):
    """縦穴の内側の壁：入口に近いところは石の色、奥へ行くほど闇に沈む（高さで暗くする）"""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nodes = nt.nodes; links = nt.links
    b = nodes.get("Principled BSDF"); b.inputs["Roughness"].default_value = 1.0
    geo = nodes.new("ShaderNodeNewGeometry"); sep = nodes.new("ShaderNodeSeparateXYZ"); links.new(geo.outputs["Position"], sep.inputs["Vector"])
    mr = nodes.new("ShaderNodeMapRange"); mr.inputs["From Min"].default_value = z_far; mr.inputs["From Max"].default_value = z_near
    links.new(sep.outputs["Z"], mr.inputs["Value"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (0.002, 0.002, 0.003, 1)
    ramp.color_ramp.elements[1].position = 1.0; ramp.color_ramp.elements[1].color = (*color, 1)
    links.new(mr.outputs["Result"], ramp.inputs["Fac"]); links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m

def mat_holdout(name):
    """見えない遮り：これに隠れた部分は透明になる（ゲームが描く床・天井の向こう側にある部品を、見えなくするため）"""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); h = nt.nodes.new("ShaderNodeHoldout"); nt.links.new(h.outputs[0], out.inputs["Surface"])
    return m

IRON = mat_rough("iron", (0.15, 0.15, 0.155), (0.30, 0.17, 0.09), rough=0.6, metal=0.8, bump=0.5, scale=26)
RUST = mat_rough("rust", (0.27, 0.14, 0.07), (0.44, 0.25, 0.11), rough=0.85, metal=0.4, bump=0.6, scale=34)
PLATE = mat_rough("plate", (0.11, 0.11, 0.115), (0.26, 0.16, 0.09), rough=0.5, metal=0.85, bump=0.8, scale=40)
STONE = mat_rough("stone", (0.30, 0.29, 0.275), (0.19, 0.185, 0.18), rough=0.92, metal=0.0, bump=0.9, scale=13)
STONE2 = mat_rough("stone2", (0.24, 0.235, 0.225), (0.15, 0.148, 0.145), rough=0.95, metal=0.0, bump=0.9, scale=13)
DARK = mat_plain("dark", (0.004, 0.004, 0.006), rough=1.0)
ROPE = mat_plain("rope", (0.06, 0.055, 0.05), rough=0.8, metal=0.4)
LAMP = mat_plain("lamp", (1.0, 0.6, 0.2), emit=(1.0, 0.42, 0.08), strength=2.2)
KNOB = mat_plain("knob", (0.55, 0.05, 0.04), rough=0.45)
HOLD = mat_holdout("holdout")
EDGE = mat_plain("edge", (0.46, 0.44, 0.40), rough=0.8)

# ── 部品を置く道具（モデルの座標：X＝横、Y＝入口(−)から奥(＋)、Z＝高さ。床 −0.5 / 天井 +0.5）──
root = bpy.data.objects.new("obj", None); scene.collection.objects.link(root)
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
def quad(pts, mat, shadow=False):
    me = bpy.data.meshes.new("q"); me.from_pydata([tuple(p) for p in pts], [], [(0, 1, 2, 3)]); me.update()
    me.materials.append(mat); o = bpy.data.objects.new("q", me); o.parent = root; scene.collection.objects.link(o)
    o.visible_shadow = shadow   # 板（縦穴の壁・見えない遮り）は、影を落とさない。光まで遮ってモデルが暗くなるため
    return o
def well(x0, x1, y0, y1, z0, z1, mat, cap):
    """縦穴の内側：4面の壁と、いちばん奥のふた（z0〜z1 のうち、入口でないほうの端）"""
    quad([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], mat)
    quad([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], mat)
    quad([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], mat)
    quad([(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], mat)
    quad([(x0, y0, cap), (x1, y0, cap), (x1, y1, cap), (x0, y1, cap)], DARK)
def mask(x0, x1, y0, y1, z):
    """床または天井の「見えない遮り」。穴（x0..x1, y0..y1）のまわりを、広く覆う"""
    B = 9.0
    for a in ([(-B, -B), (B, -B), (B, y0), (-B, y0)], [(-B, y1), (B, y1), (B, B), (-B, B)], [(-B, y0), (x0, y0), (x0, y1), (-B, y1)], [(x1, y0), (B, y0), (B, y1), (x1, y1)]):
        quad([(p[0], p[1], z) for p in a], HOLD)

HW = 0.42
FL, CE = -0.5, 0.5

def build_elev():
    TOP = 0.40; P = 0.05
    # 床（縞鋼板）と滑り止めの筋
    box(-HW, HW, -HW, HW, FL, FL + 0.025, PLATE)
    for i in range(7):
        y = -HW + 0.08 + i * 0.115
        box(-HW + 0.06, HW - 0.06, y, y + 0.012, FL + 0.025, FL + 0.032, PLATE, bevel=0)
    # 四隅の柱（天井の縦穴の中まで、案内の柱として続く）
    for sx in (-1, 1):
        for sy in (-1, 1):
            x0 = sx * HW - (P if sx > 0 else 0); y0 = sy * HW - (P if sy > 0 else 0)
            box(x0, x0 + P, y0, y0 + P, FL, TOP, IRON)
            box(x0 + 0.012, x0 + P - 0.012, y0 + 0.012, y0 + P - 0.012, TOP, 1.7, IRON, bevel=0.002)
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
    # 奥の蛇腹の格子戸
    yg = HW - P / 2
    n = 6; span = (2 * HW - 2 * P) / n
    for i in range(n):
        xa = -HW + P + i * span; xb = xa + span
        bar((xa, yg, FL + 0.03), (xb, yg, TOP), 0.007, RUST)
        bar((xb, yg, FL + 0.03), (xa, yg, TOP), 0.007, RUST)
    for i in range(n + 1):
        xa = -HW + P + i * span
        bar((xa, yg, FL + 0.03), (xa, yg, TOP), 0.006, RUST)
    # 戸の向こうの闇は、入口の側から見たときだけ見える片面の板（裏から見たときは透けて、かごの中が見える）
    d1 = mat_plain("dark1", (0.004, 0.004, 0.006), rough=1.0); d1.use_backface_culling = True
    quad([(-HW + P, yg + 0.02, FL + 0.03), (HW - P, yg + 0.02, FL + 0.03), (HW - P, yg + 0.02, TOP), (-HW + P, yg + 0.02, TOP)], d1)
    # 天井の縦穴：かごと同じ大きさの穴が上へ続く。穴のふちの鉄枠、内側の石壁、上へ伸びる吊り索
    S = HW + 0.02
    well(-S, S, -S, S, CE, 1.7, mat_shaft("shaft", (0.16, 0.155, 0.15), CE, 1.5), 1.7)
    mask(-S, S, -S, S, CE)
    R = 0.035
    box(-S - R, S + R, -S - R, -S, CE - 0.018, CE, IRON); box(-S - R, S + R, S, S + R, CE - 0.018, CE, IRON)
    box(-S - R, -S, -S, S, CE - 0.018, CE, IRON); box(S, S + R, -S, S, CE - 0.018, CE, IRON)
    for sx in (-0.05, 0.05):
        bar((sx, 0, TOP + 0.05), (sx, 0, 1.7), 0.008, ROPE)
    box(-0.09, 0.09, -0.03, 0.03, TOP + 0.05, TOP + 0.085, IRON)
    # 入口のそばの操作レバー（右手前）
    box(0.25, 0.33, -HW + 0.06, -HW + 0.12, FL + 0.025, -0.22, IRON)
    bar((0.29, -HW + 0.09, -0.22), (0.23, -HW + 0.09, -0.02), 0.009, IRON)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.022, location=(0.23, -HW + 0.09, -0.02)); o = bpy.context.object; o.data.materials.append(KNOB); o.parent = root; bpy.ops.object.shade_smooth()
    # 片隅のランタン（左手前）
    lx, ly, lz = -HW + 0.12, -HW + 0.12, 0.12
    bar((lx, ly, TOP), (lx, ly, lz + 0.055), 0.004, ROPE)
    box(lx - 0.03, lx + 0.03, ly - 0.03, ly + 0.03, lz + 0.04, lz + 0.055, IRON, bevel=0.003)
    box(lx - 0.03, lx + 0.03, ly - 0.03, ly + 0.03, lz - 0.055, lz - 0.04, IRON, bevel=0.003)
    box(lx - 0.027, lx + 0.027, ly - 0.027, ly + 0.027, lz - 0.04, lz + 0.04, LAMP, bevel=0.003)
    ld = bpy.data.lights.new("lantern", "POINT"); ld.energy = 14.0; ld.color = (1.0, 0.62, 0.3); ld.shadow_soft_size = 0.03
    lo = bpy.data.objects.new("lantern", ld); lo.location = (lx, ly, lz); lo.parent = root; scene.collection.objects.link(lo)

def handrail(x, pts, mat=IRON, post_h=0.34):
    """斜めに上る（下る）手すり。pts は足元の (y, z) の並び"""
    for (y, z) in pts:
        bar((x, y, z), (x, y, z + post_h), 0.008, mat)
    for i in range(len(pts) - 1):
        bar((x, pts[i][0], pts[i][1] + post_h), (x, pts[i + 1][0], pts[i + 1][1] + post_h), 0.011, mat)
        bar((x, pts[i][0], pts[i][1] + post_h * 0.55), (x, pts[i + 1][0], pts[i + 1][1] + post_h * 0.55), 0.006, mat)

def build_up():
    """上り階段：入口（Y−）から奥（Y＋）へ上り、天井の穴へ抜ける。石の段と、両脇の鉄の手すり"""
    W = 0.36; N = 7; run = 2 * HW / N; rise = 1.0 / N
    for i in range(N + 4):               # 天井の上（穴の中）にも4段ぶん続ける
        y0 = -HW + i * run; top = FL + (i + 1) * rise
        box(-W, W, y0, y0 + run + (0.0 if i < N + 3 else 0.2), FL if i < N else CE - 0.02, top, STONE if i % 2 == 0 else STONE2, bevel=0.006)
        box(-W, W, y0 - 0.004, y0 + 0.012, top - 0.012, top + 0.005, EDGE, bevel=0.003)   # 段の角（明るい線）
    # 段の下は石でふさぐ（横から見たとき、段の下が空かないように）
    for i in range(1, N):
        y0 = -HW + i * run
        box(-W + 0.004, W - 0.004, y0, HW, FL, FL + i * rise, STONE2, bevel=0)
    # 天井の穴（頭がつかえないよう、段の中ほどから奥まで開いている）と、その上の縦穴
    hy0 = -HW + 2 * run; hy1 = HW + 0.5
    well(-W - 0.02, W + 0.02, hy0, hy1, CE, 1.7, mat_shaft("shaftU", (0.20, 0.195, 0.185), CE, 1.4), 1.7)
    mask(-W - 0.02, W + 0.02, hy0, hy1, CE)
    R = 0.03
    box(-W - 0.02 - R, W + 0.02 + R, hy0 - R, hy0, CE - 0.016, CE, STONE2)
    box(-W - 0.02 - R, -W - 0.02, hy0, HW, CE - 0.016, CE, STONE2); box(W + 0.02, W + 0.02 + R, hy0, HW, CE - 0.016, CE, STONE2)
    # 手すり
    pts = [(-HW + (i + 0.5) * run, FL + (i + 1) * rise) for i in range(0, N + 3, 2)]
    for sx in (-1, 1):
        handrail(sx * (W - 0.02), pts)

def build_down():
    """下り階段：床に開いた穴へ、入口（Y−）から奥（Y＋）へ下りていく。穴の三方を鉄の柵で囲み、入口の側だけ開いている"""
    W = 0.36; N = 8; run = 2 * HW / N; rise = 0.11
    BOT = -1.9
    well(-W, W, -HW, HW + 0.6, BOT, FL, mat_shaft("shaftD", (0.22, 0.215, 0.205), FL, -1.45), BOT)
    mask(-W, W, -HW, HW, FL)
    # 穴の奥（向こう側の床の下）は、下の階へ続く暗い通路
    quad([(-W, HW, BOT), (W, HW, BOT), (W, HW, FL - 0.10), (-W, HW, FL - 0.10)], DARK)
    box(-W, W, HW, HW + 0.02, FL - 0.10, FL, STONE2, bevel=0)      # 向こう側の床の厚み（その下は、下の階へ続く闇）
    for i in range(N + 5):
        y0 = -HW + i * run; top = FL - (i + 1) * rise
        k = max(0.06, 1.0 - i * 0.105) * (1.0 if i % 2 == 0 else 0.78)     # 下の段ほど暗く、1段おきに少し濃く
        st = mat_rough(f"step{i}", (0.34 * k, 0.33 * k, 0.31 * k), (0.22 * k, 0.215 * k, 0.21 * k), rough=0.92, metal=0.0, bump=0.9, scale=13)
        box(-W, W, y0, y0 + run + 0.002, BOT, top, st, bevel=0.006)
        ed = mat_plain(f"edge{i}", (0.50 * k, 0.48 * k, 0.44 * k), rough=0.8)
        box(-W, W, y0, y0 + 0.014, top - 0.01, top + 0.005, ed, bevel=0.003)     # 段の角（明るい線）
    # 穴のふちの縁石
    C = 0.035
    box(-W - C, -W, -HW, HW + C, FL, FL + 0.03, STONE2); box(W, W + C, -HW, HW + C, FL, FL + 0.03, STONE2)
    box(-W, W, HW, HW + C, FL, FL + 0.03, STONE2)
    # 三方の柵（左右と奥）。入口の側は開いている
    H = 0.36; zt = FL + 0.03
    for sx in (-1, 1):
        x = sx * (W + C / 2)
        ys = [-HW + 0.02, -HW + 0.02 + (2 * HW) / 3, -HW + 0.02 + (2 * HW) * 2 / 3, HW + C / 2]
        for y in ys:
            bar((x, y, zt), (x, y, zt + H), 0.009, IRON)
        bar((x, ys[0], zt + H), (x, ys[-1], zt + H), 0.012, IRON)
        bar((x, ys[0], zt + H * 0.5), (x, ys[-1], zt + H * 0.5), 0.006, IRON)
    y = HW + C / 2
    bar((-W - C / 2, y, zt + H), (W + C / 2, y, zt + H), 0.012, IRON)
    bar((-W - C / 2, y, zt + H * 0.5), (W + C / 2, y, zt + H * 0.5), 0.006, IRON)
    bar((0, y, zt), (0, y, zt + H), 0.009, IRON)

{"elev": build_elev, "up": build_up, "down": build_down}[KIND]()

# ── カメラと明かり（明るさは均一に。距離で暗くするのはゲーム側）──
cam_d = bpy.data.cameras.new("cam"); cam_d.sensor_fit = "HORIZONTAL"; cam_d.angle_x = FOV_X; cam_d.clip_start = 0.02; cam_d.clip_end = 60
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
for e in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
    try:
        scene.render.engine = e; break
    except Exception:
        pass
try:
    scene.view_settings.view_transform = "Standard"
except Exception:
    pass

# ── 置く位置と向き：dd＝何マス先 / l＝横に何マス（右が＋）/ rel＝向き（0 奥・1 右・2 手前・3 左）──
def place(dd, l, rel):
    root.location = (l, dd + ZO + 0.5, 0)
    root.rotation_euler = (0, 0, -rel * math.pi / 2)
def render(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

DDS = (0, 1, 2, 3, 4) if KIND == "down" else (1, 2, 3, 4)   # 下り階段は、自分のいるマスのものも描く（足元の穴）
if MODE == "test":
    tests = [(1, 0, 0), (1, 0, 1), (1, 0, 2), (2, 1, 3), (2, 0, 0)] + ([(0, 0, 0)] if KIND == "down" else [])
    for dd, l, rel in tests:
        place(dd, l, rel); render(os.path.join(OUT, f"t_{KIND}_d{dd}_l{l}_r{rel}.png"))
else:
    import numpy as np
    man = {"w": RES[0], "h": RES[1], "items": {}}
    tmp = os.path.join(OUT, "_tmp.png")
    # 枚数を減らす工夫（ゲーム側で補う）：
    #   ・左側（l<0）は描かない。右側の絵を左右反転して使う
    #   ・3〜4マス先は、2マス先の絵を縮めて使う。ただし横に3マス離れた位置は、2マス先では画面の外なので、そのまま描く
    for dd in DDS:
        for l in (0, 1, 2, 3):
            if dd >= 3 and l <= 2:
                continue
            for rel in (0, 1, 2, 3):
                place(dd, l, rel); render(tmp)
                img = bpy.data.images.load(tmp, check_existing=False)
                w, h = img.size; px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
                ys, xs = np.where(px[:, :, 3] > 0.01)
                bpy.data.images.remove(img)
                if len(xs) < 40:
                    continue
                x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
                name = f"{KIND}_d{dd}_l{l}_r{rel}.png"
                out = bpy.data.images.new("c", x1 - x0, y1 - y0, alpha=True)
                out.pixels.foreach_set(px[y0:y1, x0:x1, :].reshape(-1)); out.filepath_raw = os.path.join(OUT, name); out.file_format = "PNG"; out.save(); bpy.data.images.remove(out)
                man["items"][f"{dd},{l},{rel}"] = [name, x0, h - y1, x1 - x0, y1 - y0]   # 画像は下が原点なので、上からの位置に直す
    if os.path.exists(tmp): os.remove(tmp)
    with open(os.path.join(OUT, KIND + ".json"), "w") as f: json.dump(man, f)
    print("DONE", KIND, len(man["items"]))
