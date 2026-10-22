// 武器 / 遗物 / 协同 / 主动道具数据（模拟层数据；所有者 items）。
// 钩子函数在运行时才执行，可以引用 G.Items 与 G.IH（items.js 中的辅助函数）。
// 数值单位：伤害为敌人 HP（普通敌人 10–30）；rate 每秒发射次数；spd 像素/秒；life 秒；cost 每次开火能量（beam/flame 为每秒能量）。
(function (G) {
  'use strict';

  // ===================== 武器 =====================
  // kind: gun 普通射击 | charge 蓄力 | melee 近战挥砍 | beam 持续激光 | lob 抛物线投掷 | chain 连锁闪电 | flame 喷火
  G.WEAPONS = {
    pistol: {
      name: '旧式手枪', rarity: 1, kind: 'gun', pool: 'start', cost: 0,
      dmg: 3.2, rate: 4, spd: 540, spread: 0.06, n: 1, life: 0.9, r: 4, shape: 'bolt', color: '#fee761', knock: 1,
      desc: '游侠的老伙计。不耗能量，弹道稳定。'
    },
    frost_wand: {
      name: '霜晶法杖', rarity: 1, kind: 'gun', pool: 'start', cost: 0,
      dmg: 2.6, rate: 4.2, spd: 460, spread: 0.05, n: 1, life: 1.1, r: 5, shape: 'shard', color: '#2ce8f5', knock: 0.6,
      chillProc: 0.3,
      desc: '发射冰晶。30% 几率使敌人减速 1.5 秒。不耗能量。'
    },
    shotgun: {
      name: '双管霰弹枪', rarity: 1, kind: 'gun', pool: 'start', cost: 0,
      dmg: 2.1, rate: 1.7, spd: 500, spread: 0.55, n: 6, life: 0.42, r: 4, shape: 'pellet', color: '#fee761', knock: 1.8,
      desc: '一次喷出 6 发弹丸，近身威力巨大，击退强。不耗能量。'
    },
    flask_sling: {
      name: '药瓶投掷器', rarity: 1, kind: 'lob', pool: 'start', cost: 0,
      dmg: 5, rate: 1.4, spd: 420, range: 280, explode: 46, r: 6, shape: 'flask', color: '#63c74d',
      cloud: { rad: 44, t: 2, dps: 2.2 },
      desc: '把药瓶抛向准星（最远 280）。落地爆炸并留下毒雾，可越过障碍。不耗能量。'
    },
    smg: {
      name: '冲锋枪', rarity: 2, kind: 'gun', pool: 'base', cost: 1,
      dmg: 1.6, rate: 11, spd: 580, spread: 0.2, n: 1, life: 0.7, r: 3, shape: 'bolt', color: '#fee761', knock: 0.5,
      desc: '射速极高的泼水武器，散布较大。'
    },
    hunter_bow: {
      name: '猎弓', rarity: 2, kind: 'charge', pool: 'base', cost: 2,
      dmg: 3, dmgFull: 13, chargeT: 0.6, spd: 520, spdFull: 860, life: 0.95, r: 4, shape: 'arrow', color: '#ead4aa',
      pierceFull: 1, knock: 1.4,
      desc: '按住蓄力、松开放箭。满蓄力箭矢伤害 13、穿透 1 个敌人。'
    },
    katana: {
      name: '太刀', rarity: 3, kind: 'melee', pool: 'base', cost: 0,
      dmg: 6.5, rate: 2.6, range: 74, arc: 1.95, knock: 2.6, color: '#ffffff',
      desc: '挥出 110° 的斩击，伤害 6.5，可以斩断扇形内的敌弹。不耗能量。'
    },
    bouncer: {
      name: '弹跳球', rarity: 2, kind: 'gun', pool: 'base', cost: 1,
      dmg: 4.5, rate: 3.2, spd: 430, spread: 0.08, n: 1, life: 2.4, r: 6, shape: 'orb', color: '#63c74d', knock: 1,
      bounce: 4, pierce: 1, bounceDmg: 0.25,
      desc: '撞墙反弹 4 次并可穿透 1 个敌人，每次反弹伤害 +25%。'
    },
    crossbow: {
      name: '重弩', rarity: 2, kind: 'gun', pool: 'base', cost: 2,
      dmg: 10, rate: 1.3, spd: 780, spread: 0, n: 1, life: 0.9, r: 5, shape: 'arrow', color: '#c0cbdc', knock: 2.4,
      pierce: 3, critAdd: 0.15,
      desc: '沉重的弩箭，伤害 10，穿透 3 个敌人，自带 +15% 暴击率。'
    },
    laser: {
      name: '光束步枪', rarity: 3, kind: 'beam', pool: 'base', cost: 6,
      dps: 17, tick: 0.1, range: 560, width: 8, color: '#2ce8f5',
      desc: '按住发射持续激光，每秒 17 伤害，贯穿直线上所有敌人。每秒消耗 6 能量。'
    },
    rocket: {
      name: '火箭筒', rarity: 3, kind: 'gun', pool: 'base', cost: 4,
      dmg: 7, rate: 1.0, spd: 330, spread: 0, n: 1, life: 1.7, r: 6, shape: 'rocket', color: '#fee761', knock: 2,
      explode: 66, accel: 380,
      desc: '发射加速火箭，命中后爆炸（半径 66）对范围内敌人造成伤害。'
    },
    star_scatter: {
      name: '星辰散射', rarity: 3, kind: 'gun', pool: 'base', cost: 3,
      dmg: 1.9, rate: 2.2, spd: 380, spread: 0.75, n: 5, life: 1.5, r: 5, shape: 'star', color: '#fee761', knock: 0.6,
      homing: 1.4,
      desc: '扇形射出 5 颗星弹，星弹会追踪附近的敌人。'
    },
    minigun: {
      name: '加特林', rarity: 4, kind: 'gun', pool: 'base', cost: 0.6,
      dmg: 1.7, rate: 19, spd: 620, spread: 0.18, n: 1, life: 0.7, r: 3, shape: 'bolt', color: '#fee761', knock: 0.4,
      spinUp: 0.9,
      desc: '按住后枪管逐渐加速（0.9 秒满转），满速时每秒 19 发。'
    },
    thunder_staff: {
      name: '雷霆法杖', rarity: 4, kind: 'chain', pool: 'unlock', cost: 3,
      dmg: 7, rate: 2.4, range: 320, cone: 0.55, chains: 4, hop: 150, falloff: 0.85, color: '#2ce8f5',
      desc: '瞬间击中前方最近的敌人，并连锁到附近 4 个敌人（每跳伤害 -15%）。'
    },
    dragon_breath: {
      name: '龙息喷火器', rarity: 4, kind: 'flame', pool: 'unlock', cost: 5,
      dmg: 1.1, rate: 22, spd: 320, spread: 0.3, n: 1, life: 0.42, r: 7, shape: 'flame', color: '#fee761', knock: 0.15,
      pierce: 99, burn: [5, 2.5],
      desc: '短程喷射火焰，穿透所有敌人并必定点燃（每秒 5 伤害，2.5 秒）。每秒消耗 5 能量。'
    },
    railgun: {
      name: '电磁炮', rarity: 5, kind: 'charge', pool: 'unlock', cost: 6,
      dmg: 8, dmgFull: 46, chargeT: 1.15, spd: 1300, spdFull: 1500, life: 0.6, r: 5, shape: 'bolt', color: '#2ce8f5',
      pierceFull: 99, knock: 3,
      desc: '蓄力后发射电磁弹。满蓄力伤害 46，贯穿所有敌人。'
    },
    void_cannon: {
      name: '虚空炮', rarity: 5, kind: 'gun', pool: 'unlock', cost: 8,
      dmg: 2, rate: 0.7, spd: 150, spread: 0, n: 1, life: 2.6, r: 12, shape: 'void', color: '#0099db', knock: 0,
      pull: 130, pullStr: 240, boom: 22, boomRad: 84,
      desc: '发射缓慢的黑洞，持续吸附并伤害周围敌人，消散时坍缩爆炸（伤害 22）。'
    }
  };
  G.WEAPON_ORDER = Object.keys(G.WEAPONS);

  // ===================== 遗物 =====================
  // stats：每层叠加的加法属性；minus：每层扣减的属性（代价）；hooks(S, ctx, n=层数, p)
  // pool: base 常规掉落 | unlock 魂晶解锁后进入掉落池 | altar 只在祭坛出现
  const H = () => G.IH;   // items.js 提供的辅助函数（运行时取）
  const status = (e, k) => !!(e && e.status && e.status[k] && (typeof e.status[k] === 'number' ? e.status[k] > 0 : e.status[k].t > 0));
  G.RELICS = {
    power_potion: { name: '力量药剂', rarity: 1, family: null, max: 5, pool: 'base',
      stats: { dmgMul: 0.15 }, desc: '伤害 +15%。' },
    trigger_spring: { name: '扳机弹簧', rarity: 1, family: null, max: 5, pool: 'base',
      stats: { rateMul: 0.12 }, desc: '射速 +12%。' },
    swift_feather: { name: '疾风之羽', rarity: 1, family: null, max: 3, pool: 'base',
      stats: { spdMul: 0.1, dodgeCdMul: -0.12 }, desc: '移动速度 +10%，翻滚冷却 -12%。' },
    heart_vessel: { name: '心之容器', rarity: 2, family: null, max: 4, pool: 'base',
      stats: { maxHp: 2 }, desc: '最大生命 +1 颗心（新增的心是满的），并额外回复 1 颗心。',
      hooks: { onGain(S) { G.healPlayer(S, 2); } } },
    iron_skin: { name: '铁皮护符', rarity: 1, family: 'aegis', max: 3, pool: 'base',
      stats: { shieldMax: 1, shieldRegen: 0.15 }, desc: '护盾上限 +1，护盾回复速度 +15%。',
      hooks: { onGain(S) { G.addShield(S, 1); } } },
    coin_magnet: { name: '金币磁铁', rarity: 1, family: null, max: 2, pool: 'base',
      stats: { magnet: 1, goldMul: 0.25 }, desc: '金币与能量球自动飞向你，金币掉落 +25%。' },
    big_bullets: { name: '巨人弹药', rarity: 2, family: null, max: 3, pool: 'base',
      stats: { bulletSize: 0.35, dmgMul: 0.08, knock: 0.3 }, desc: '子弹体积 +35%，伤害 +8%，击退 +30%。' },
    lucky_dice: { name: '幸运骰子', rarity: 2, family: 'crit', max: 4, pool: 'base',
      stats: { crit: 0.1, luck: 1 }, desc: '暴击率 +10%，宝物更容易出现高稀有度。' },
    ember_core: { name: '余烬核心', rarity: 2, family: 'fire', max: 3, pool: 'base',
      stats: { burnChance: 0.15, burnDps: 1.5 }, desc: '攻击有 15% 几率点燃敌人（每秒 3 伤害，持续 3 秒），燃烧伤害 +1.5。' },
    frost_shard: { name: '寒霜碎片', rarity: 2, family: 'frost', max: 3, pool: 'base',
      stats: { chillChance: 0.18 }, desc: '攻击有 18% 几率使敌人减速 40%，持续 1.5 秒（对首领减半）。' },
    venom_gland: { name: '毒腺', rarity: 2, family: 'toxic', max: 3, pool: 'base',
      stats: { poisonChance: 0.2, poisonDps: 1 }, desc: '攻击有 20% 几率使敌人中毒（每秒 2 伤害，持续 4 秒，最多叠 5 层），中毒伤害 +1。' },
    split_shot: { name: '分裂弹', rarity: 3, family: 'barrage', max: 3, pool: 'base',
      stats: { multi: 1 }, desc: '每次射击多发射 1 发子弹；子弹分摊伤害，总伤害 +35%。' },
    pierce_tip: { name: '穿甲弹头', rarity: 2, family: null, max: 3, pool: 'base',
      stats: { pierce: 1 }, desc: '子弹可多穿透 1 个敌人。' },
    rubber_rounds: { name: '橡胶子弹', rarity: 1, family: 'barrage', max: 3, pool: 'base',
      stats: { bounce: 1, bulletSpd: 0.05 }, desc: '子弹撞墙反弹 +1 次，弹速 +5%。' },
    homing_chip: { name: '追踪芯片', rarity: 3, family: null, max: 2, pool: 'base',
      stats: { homing: 0.8 }, desc: '子弹会转向附近的敌人。' },
    vampire_fang: { name: '吸血獠牙', rarity: 3, family: null, max: 2, pool: 'base',
      stats: { lifesteal: 0.06 }, desc: '击杀敌人时有 6% 几率回复半颗心（召唤物除外）。',
      hooks: { onKill(S, c, n, p) { if (c.e && !c.e.summon && S.rng.chance(Math.min(0.2, p.st.lifesteal || 0))) G.healPlayer(S, 1); } } },
    thorn_mail: { name: '荆棘甲', rarity: 2, family: 'aegis', max: 3, pool: 'base',
      stats: { thorns: 1 }, desc: '受到攻击时（包括被护盾挡下）向四周射出 8 根尖刺，伤害随伤害加成提升，每层 +4 根。',
      hooks: { onHurt(S, c, n, p) { H().spikes(S, p.x, p.y, 4 + 4 * n, 5 * p.st.dmgMul, { color: '#63c74d', shape: 'spike', pierce: 1 }); } } },
    fire_boots: { name: '烈焰之靴', rarity: 2, family: 'fire', max: 2, pool: 'base',
      stats: { dodgeCdMul: -0.1, spdMul: 0.05 }, desc: '翻滚时在身后留下燃烧火焰（每秒 8 伤害），翻滚冷却 -10%，移速 +5%。',
      hooks: {
        onDodge(S, c, n, p) { p._trail = 0; },
        onTick(S, c, n, p) {
          if (p.rolling > 0) {
            p._trail = (p._trail || 0) - c.dt;
            if (p._trail <= 0) { p._trail = 0.05; G.addHazard(S, { kind: 'fire', own: 'p', x: p.x, y: p.y, rad: 18, t: 2.5, max: 2.5, dps: 8 * n * p.st.dmgMul, tick: 0 }); }
          }
        }
      } },
    hourglass: { name: '时之沙漏', rarity: 3, family: null, max: 2, pool: 'base',
      stats: { skillCdMul: -0.2 }, desc: '角色技能冷却 -20%（最多减少 50%）。' },
    sharp_eye: { name: '鹰眼', rarity: 2, family: 'crit', max: 3, pool: 'base',
      stats: { critMul: 0.3, bulletSpd: 0.1 }, desc: '暴击伤害 +30%，弹速 +10%。' },
    ice_heart: { name: '冰霜之心', rarity: 3, family: 'frost', max: 1, pool: 'base',
      stats: { chillChance: 0.1 }, desc: '减速或冰冻中的敌人死亡时碎裂，向四周射出 6 片冰晶。减速几率 +10%。',
      hooks: { onKill(S, c, n, p) { if (status(c.e, 'chill') || status(c.e, 'freeze')) H().spikes(S, c.e.x, c.e.y, 6, 4 * p.st.dmgMul, { color: '#2ce8f5', shape: 'shard', status: { chill: 1.5 } }); } } },
    explosive_rounds: { name: '爆裂弹头', rarity: 3, family: 'fire', max: 2, pool: 'base',
      stats: {}, desc: '子弹命中时有 25% 几率引发小爆炸（半径 36，造成该次伤害的 60%），每层 +15% 几率。',
      hooks: { onHit(S, c, n, p) { if (c.kind === 'bullet' && c.b && S.rng.chance(0.1 + 0.15 * n)) H().boom(S, c.e.x, c.e.y, 36, Math.max(1, c.dmg * 0.6)); } } },
    echo_barrel: { name: '回声枪管', rarity: 3, family: 'barrage', max: 2, pool: 'base',
      stats: {}, desc: '射击时有 25% 几率在 0.1 秒后再射出一轮回声子弹（伤害 60%），每层 +15% 几率。仅限射击类武器。',
      hooks: { onFire(S, c, n, p) { if (c.kind === 'gun' && !c.echo && S.rng.chance(0.1 + 0.15 * n)) H().echo(S, p, c, 0.1, 0.6); } } },
    guardian_orb: { name: '守护法球', rarity: 3, family: 'aegis', max: 3, pool: 'base',
      stats: {}, desc: '1 颗法球环绕你旋转，抵挡敌弹并灼伤接触的敌人（每次 4 伤害）。每层 +1 颗。',
      hooks: { onTick(S, c, n, p) { H().orbs(S, p, n, c.dt); } } },
    plague_flask: { name: '瘟疫瓶', rarity: 3, family: 'toxic', max: 2, pool: 'base',
      stats: { poisonDps: 1 }, desc: '中毒的敌人死亡时留下一团毒雾（每秒 5 伤害，3 秒）。中毒伤害 +1。',
      hooks: { onKill(S, c, n, p) { if (status(c.e, 'poison')) G.addHazard(S, { kind: 'poison', own: 'p', x: c.e.x, y: c.e.y, rad: 46 + 8 * n, t: 3, max: 3, dps: 5 * p.st.dmgMul, tick: 0 }); } } },
    assassin_mark: { name: '刺客印记', rarity: 3, family: 'crit', max: 2, pool: 'base',
      stats: { crit: 0.05 }, desc: '对满血敌人造成的伤害 +60%（首领为 +30%），每层叠加；暴击击杀后，下一次攻击必定暴击。暴击率 +5%。',
      hooks: { onKill(S, c, n, p) { if (c.e && c.e._lastCrit) p._sureCrit = 1; } } },
    energy_battery: { name: '能量电池', rarity: 1, family: null, max: 3, pool: 'base',
      stats: { energyMax: 40, energyRegen: 1 }, desc: '能量上限 +40，每秒能量回复 +1。',
      hooks: { onGain(S) { G.addEnergy(S, 40); } } },
    phoenix_feather: { name: '凤凰之羽', rarity: 5, family: null, max: 1, pool: 'unlock',
      stats: {}, desc: '受到致命伤害时浴火重生：回复一半生命，2 秒无敌，并向四周喷发烈焰。触发后消失。',
      hooks: { onHurt(S, c, n, p) { if (p.hp <= 0) H().phoenix(S, p); } } },
    glacier_crown: { name: '冰川王冠', rarity: 4, family: 'frost', max: 1, pool: 'unlock',
      stats: { chillChance: 0.15 }, desc: '命中减速中的敌人有 15% 几率将其冰冻 1.5 秒（首领改为减速）；冰冻的敌人受到的伤害 +50%。减速几率 +15%。',
      hooks: { onHit(S, c, n, p) {
        const e = c.e; if (!e || e.hp <= 0 || c.kind === 'burn' || c.kind === 'poison') return;
        if (status(e, 'chill') && !status(e, 'freeze') && S.rng.chance(0.15)) H().freeze(S, e, 1.5);
      } } },
    inferno_heart: { name: '炼狱之心', rarity: 4, family: 'fire', max: 1, pool: 'unlock',
      stats: { burnChance: 0.1, burnDps: 3 }, desc: '燃烧中的敌人死亡时爆炸（半径 60，伤害 10）。点燃几率 +10%，燃烧伤害 +3。',
      hooks: { onKill(S, c, n, p) { if (status(c.e, 'burn')) H().boom(S, c.e.x, c.e.y, 60, 10 * p.st.dmgMul, { status: { burn: [3 + (p.st.burnDps || 0), 3] } }); } } },
    bullet_storm: { name: '弹幕风暴', rarity: 4, family: 'barrage', max: 1, pool: 'base',
      stats: { rateMul: 0.2 }, desc: '射速 +20%。每开火 12 次，向四周射出一圈 10 发子弹（伤害 60%）。',
      hooks: { onFire(S, c, n, p) {
        if (c.echo) return; p._storm = (p._storm || 0) + 1;
        if (p._storm >= 12) { p._storm = 0; H().spikes(S, p.x, p.y, 10, Math.max(1, c.dmg * 0.6), { color: '#fee761', shape: 'star' }); }
      } } },
    golden_idol: { name: '黄金神像', rarity: 4, family: null, max: 1, pool: 'unlock',
      stats: { goldMul: 0.4, shopDiscount: 0.1 }, desc: '金币掉落 +40%，商店价格 -10%；每持有 10 金币伤害 +2%（最多 +30%）。' },
    abyss_contract: { name: '深渊契约', rarity: 4, family: null, max: 1, pool: 'altar',
      stats: { dmgMul: 0.45, crit: 0.1 }, minus: { maxHp: 2 }, desc: '伤害 +45%，暴击率 +10%；代价：最大生命 -1 颗心。只在祭坛出现。' },
    toxic_crown: { name: '剧毒王冠', rarity: 5, family: 'toxic', max: 1, pool: 'unlock',
      stats: { poisonChance: 0.2, poisonDps: 2 }, desc: '中毒的敌人死亡时，毒素传染给附近 3 个敌人。中毒几率 +20%，中毒伤害 +2。',
      hooks: { onKill(S, c, n, p) { if (status(c.e, 'poison')) H().spread(S, c.e, 3, 140, { poison: [2 + (p.st.poisonDps || 0), 4] }); } } }
  };
  G.RELIC_ORDER = Object.keys(G.RELICS);

  // ===================== 协同（同系不同遗物的件数） =====================
  // 档位 stats 累加（3 件档同时拥有 2 件档效果）；hooks 签名同遗物（n 恒为 1）
  G.SYNERGIES = {
    fire: { name: '烈焰', color: '#f77622', tiers: [
      { n: 2, desc: '点燃几率 +10%，燃烧伤害 +2。', stats: { burnChance: 0.1, burnDps: 2 } },
      { n: 3, desc: '命中燃烧中的敌人时有 20% 几率引发火焰爆炸（半径 40）。',
        hooks: { onHit(S, c, n, p) { if ((c.kind === 'bullet' || c.kind === 'melee' || c.kind === 'beam') && c.e && c.e.status && c.e.status.burn && c.e.status.burn.t > 0 && S.rng.chance(0.2)) G.IH.boom(S, c.e.x, c.e.y, 40, Math.max(2, c.dmg * 0.8)); } } }
    ] },
    frost: { name: '寒霜', color: '#2ce8f5', tiers: [
      { n: 2, desc: '减速几率 +15%；对减速或冰冻中的敌人伤害 +20%。', stats: { chillChance: 0.15 } },
      { n: 3, desc: '翻滚时释放寒冰新星，冰冻周围 110 内的敌人 1.2 秒（首领改为减速）。',
        hooks: { onDodge(S, c, n, p) { G.IH.nova(S, p, 110, 1.2); } } }
    ] },
    barrage: { name: '弹幕', color: '#fee761', tiers: [
      { n: 2, desc: '射速 +10%，弹速 +10%。', stats: { rateMul: 0.1, bulletSpd: 0.1 } },
      { n: 3, desc: '每次射击额外发射 1 发追踪星弹（伤害 40%）。',
        hooks: { onFire(S, c, n, p) { if (c.kind === 'gun' && !c.echo) G.IH.seeker(S, p, c); } } }
    ] },
    crit: { name: '暴击', color: '#e43b44', tiers: [
      { n: 2, desc: '暴击率 +8%，暴击伤害 +20%。', stats: { crit: 0.08, critMul: 0.2 } },
      { n: 3, desc: '暴击时释放闪电，跳向附近 2 个敌人（伤害 50%）。',
        hooks: { onHit(S, c, n, p) { if (c.crit && c.e && (c.kind === 'bullet' || c.kind === 'melee')) G.IH.zap(S, c.e, 2, c.dmg * 0.5); } } }
    ] },
    aegis: { name: '护盾', color: '#c0cbdc', tiers: [
      { n: 2, desc: '护盾上限 +1，护盾回复速度 +30%。', stats: { shieldMax: 1, shieldRegen: 0.3 } },
      { n: 3, desc: '受到攻击时释放冲击波：清除身边 120 内的敌弹并击退敌人（每 1.5 秒最多一次）。',
        hooks: { onHurt(S, c, n, p) { G.IH.shockwave(S, p, 120); } } }
    ] },
    toxic: { name: '剧毒', color: '#63c74d', tiers: [
      { n: 2, desc: '中毒几率 +15%，中毒伤害 +1。', stats: { poisonChance: 0.15, poisonDps: 1 } },
      { n: 3, desc: '中毒的敌人受到的所有伤害 +25%。' }
    ] }
  };
  G.SYNERGY_ORDER = ['fire', 'frost', 'barrage', 'crit', 'aegis', 'toxic'];

  // ===================== 主动道具（F 键；charge = 需要清理的房间数） =====================
  G.ACTIVES = {
    bomb: { name: '炸弹', rarity: 1, charge: 1, desc: '在脚下引爆炸弹：半径 110 内造成 30 点伤害，并清除范围内的敌弹。',
      use(S) { const p = S.p; G.IH.clearEBullets(S, p.x, p.y, 110); G.IH.boom(S, p.x, p.y, 110, 30 * p.st.dmgMul); } },
    stopwatch: { name: '怀表', rarity: 3, charge: 3, desc: '时间停滞：冻结所有敌人 3 秒（首领改为减速），敌弹速度降低 75%。',
      use(S) { for (const e of S.enemies) if (e.hp > 0) G.IH.freeze(S, e, 3); for (const b of S.bullets) if (b.own === 'e') { b.vx *= 0.25; b.vy *= 0.25; } G.emit('shake', { amt: 4 }); } },
    medkit: { name: '急救包', rarity: 2, charge: 3, desc: '回复 2 颗心。',
      use(S) { G.healPlayer(S, 4); } },
    barrier: { name: '屏障', rarity: 2, charge: 2, desc: '护盾充满并获得 1 层护甲，1.5 秒内免疫伤害。',
      use(S) { const p = S.p; G.addShield(S, 99); G.addArmor(S, 1); p.iframes = Math.max(p.iframes || 0, 1.5); } },
    drone: { name: '战斗无人机', rarity: 3, charge: 3, desc: '召唤一架无人机跟随你 20 秒，每 0.35 秒向最近的敌人射击（伤害 3）。',
      use(S) { const p = S.p; p.drone = { x: p.x, y: p.y - 30, t: 20, ang: 0, cd: 0 }; } }
  };
  G.ACTIVE_ORDER = Object.keys(G.ACTIVES);
})(window.Game = window.Game || {});
