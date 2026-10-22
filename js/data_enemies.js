// 《裂隙猎人》敌人数据：普通敌人、Boss、精英词缀、楼层怪物池（所有者：enemies）
// 加载时不碰 DOM；行为钩子在 enemies.js 里挂到 G.AFFIXES 上。
(function (G) {
  'use strict';

  // hp：第 1 层普通难度基础血量（enemies.js onSpawn 再乘 楼层系数 × S.dm.ehp × 词缀 hpMul）
  // spd：移动速度（像素/秒）；r：碰撞半径；tele：基础预警秒数（第 1 层自动抬到 ≥0.7，再 ×S.dm.tele，结果 ≥0.5）
  // energy：死亡掉落能量球的概率（0..1）
  // shooter：会射弹（"分裂弹"词缀只给射手类）；noKnock：不受击退；flying：飞行（移动 who='f'）
  G.ENEMIES = {
    slime:   { name: '苔藓史莱姆', hp: 16, spd: 70, r: 15, ai: 'slime', gold: 2, energy: 0.3, contact: 1, tier: 1, tele: 0.7,
               desc: '蹦跳着逼近，落点会提前显示；死亡后分裂成两只小史莱姆。' },
    slimelet:{ name: '小史莱姆', hp: 5, spd: 85, r: 9, ai: 'slimelet', gold: 0, energy: 0, contact: 1, tier: 1, tele: 0.5,
               desc: '小而快，连续短跳。' },
    boar:    { name: '獠牙野猪', hp: 15, spd: 62, r: 15, ai: 'boar', gold: 2, energy: 0.3, contact: 1, tier: 1, tele: 0.9,
               desc: '低头蓄力后沿直线冲锋，撞墙会眩晕。' },
    archer:  { name: '哥布林弓手', hp: 10, spd: 70, r: 13, ai: 'archer', gold: 2, energy: 0.3, contact: 1, tier: 1, tele: 0.8, shooter: true,
               desc: '保持距离，拉弓瞄准后射出一箭。' },
    shroom:  { name: '爆裂蘑菇', hp: 9, spd: 78, r: 13, ai: 'shroom', gold: 1, energy: 0.3, contact: 1, tier: 1, tele: 0.9,
               desc: '贴近后膨胀并自爆，看到红圈就跑。' },
    bat:     { name: '吸血蝙蝠', hp: 5, spd: 110, r: 10, ai: 'bat', gold: 1, energy: 0, contact: 1, tier: 1, tele: 0.7, flying: true,
               desc: '飞行，绕圈骚扰并不时俯冲。' },
    guard:   { name: '持盾卫兵', hp: 26, spd: 52, r: 16, ai: 'guard', gold: 3, energy: 0.3, contact: 1, tier: 2, tele: 0.8,
               desc: '正面盾牌减免八成伤害；盾击后会露出破绽，从侧面或背后攻击它。' },
    imp:     { name: '火焰小鬼', hp: 14, spd: 60, r: 13, ai: 'imp', gold: 2, energy: 0.3, contact: 1, tier: 2, tele: 0.8, shooter: true, flying: true,
               desc: '漂浮施法，放出环形火球，偶尔瞬移。' },
    mole:    { name: '钻地鼹鼠', hp: 16, spd: 95, r: 14, ai: 'mole', gold: 2, energy: 0.3, contact: 1, tier: 2, tele: 0.8, shooter: true,
               desc: '在地下潜行（无法被击中），破土前地面会出现裂纹圈。' },
    turret:  { name: '熔岩炮台', hp: 30, spd: 0, r: 16, ai: 'turret', gold: 3, energy: 0.3, contact: 1, tier: 2, tele: 0.8, shooter: true, noKnock: true,
               desc: '固定不动，炮口转向你后连射，偶尔四向喷射。' },
    toad:    { name: '熔岩蟾蜍', hp: 20, spd: 40, r: 15, ai: 'toad', gold: 2, energy: 0.3, contact: 1, tier: 2, tele: 0.8,
               desc: '高高跃起砸向你的位置，落地留下熔岩。' },
    shaman:  { name: '召唤萨满', hp: 20, spd: 50, r: 14, ai: 'shaman', gold: 4, energy: 0.5, contact: 1, tier: 2, tele: 0.9, shooter: true,
               desc: '召唤蝙蝠（最多 3 只），召唤物随它死亡而消散。优先击杀！' },
    wraith:  { name: '虚空幽魂', hp: 18, spd: 90, r: 13, ai: 'wraith', gold: 3, energy: 0.3, contact: 1, tier: 3, tele: 0.7, flying: true,
               desc: '隐身接近，现形后蓄力突袭。现形时才能被击中。' },
    priest:  { name: '暗影祭司', hp: 22, spd: 55, r: 14, ai: 'priest', gold: 4, energy: 0.5, contact: 1, tier: 3, tele: 0.8, shooter: true,
               desc: '远离战线为同伴治疗，空闲时发射扇形暗影弹。' },
    sniper:  { name: '深渊狙击手', hp: 16, spd: 55, r: 13, ai: 'sniper', gold: 3, energy: 0.3, contact: 1, tier: 3, tele: 1.3, shooter: true,
               desc: '长时间瞄准（红线锁定后才开火），子弹很快。' },
    abyss_knight: { name: '深渊骑士', hp: 40, spd: 60, r: 16, ai: 'knight', gold: 4, energy: 0.5, contact: 1, tier: 3, tele: 0.75,
               desc: '远处突进、近处挥砍，招式后有明显硬直。' },

    // ---- Boss（血量 ×S.dm.ehp；不吃楼层系数）。tempo＝招式间隔倍率（>1 更从容），bigDmg＝大招伤害（缺省 2）。
    //      平衡第 3 轮（见 TESTING.md）：史莱姆之王 750 血/节奏 1.45/二阶段跳砸 1 点；熔岩魔像 1500/1.15；深渊之眼 2700/0.8 ----
    slime_king: { name: '史莱姆之王', title: '苔藓地窖的黏稠君主', hp: 750, tempo: 1.45, bigDmg: 1, spd: 55, r: 34, ai: 'slime_king', gold: 30, energy: 1,
                  contact: 1, boss: true, noKnock: true, tier: 1, tele: 0.9, desc: '跳砸、黏液雨、喷吐、召唤小史莱姆。' },
    lava_golem: { name: '熔岩魔像', title: '矿坑深处苏醒的熔炉之心', hp: 1500, tempo: 1.15, spd: 60, r: 32, ai: 'lava_golem', gold: 40, energy: 1,
                  contact: 1, boss: true, noKnock: true, tier: 2, tele: 0.8, desc: '冲撞、陨石、扇形火焰、螺旋弹；二阶段喷发十字熔流。' },
    abyss_eye:  { name: '深渊之眼', title: '裂隙尽头的凝视者', hp: 2700, tempo: 0.8, spd: 60, r: 36, ai: 'abyss_eye', gold: 0, energy: 1,
                  contact: 1, boss: true, noKnock: true, flying: true, tier: 3, tele: 0.8, desc: '缺口环弹、放射弹流、召唤；二阶段激光扫射与瞬移。' }
  };

  // 精英词缀：color 为精英发光描边色；行为钩子（onSpawn/onTick/onDeath）由 enemies.js 挂载
  G.AFFIXES = {
    berserk:  { name: '狂暴', color: '#e43b44', hpMul: 2.0, spdMul: 1.3, desc: '移动更快、出手间隔更短；半血以下更加疯狂（预警时长不变）。' },
    shielded: { name: '护盾', color: '#2ce8f5', hpMul: 1.8, spdMul: 1.0, desc: '额外护盾吸收伤害（30% 生命），4 秒未受击后护盾重生。' },
    splitter: { name: '分裂弹', color: '#feae34', hpMul: 2.0, spdMul: 1.0, desc: '每次射击额外分裂出两侧子弹。' },
    vampiric: { name: '吸血', color: '#b55088', hpMul: 2.0, spdMul: 1.05, desc: '持续回复生命，吸收附近死去同伴的生命。' },
    volatile: { name: '爆裂', color: '#f77622', hpMul: 1.8, spdMul: 1.1, desc: '死亡时原地留下一圈延迟爆炸，快离开红圈！' }
  };
  G.AFFIX_ORDER = ['berserk', 'shielded', 'splitter', 'vampiric', 'volatile'];

  // 楼层：pool[].from = 本层第几个战斗房（0 起）开始出现；wave=每波数量（未乘 S.dm.count）；waves=波数
  G.FLOORS = [
    // rogue3（评审 9）：第 1 层所有预警 ×1.2（史莱姆之王跳砸约 +0.15 秒），新手 bot 第 1 层死亡 4/30 → 2/30
    { name: '苔藓地窖', theme: 'moss', boss: 'slime_king', bspd: 1.0, elite: 0.04, hpMul: 1.0, tele: 1.2,
      affixes: ['berserk', 'shielded', 'volatile'], wave: [2, 4], waves: [1, 2],
      pool: [ { type: 'slime', w: 3, from: 0 }, { type: 'boar', w: 3, from: 0 }, { type: 'archer', w: 3, from: 0 },
              { type: 'shroom', w: 2, from: 2 }, { type: 'bat', w: 1, from: 2 } ] },
    { name: '熔岩矿坑', theme: 'lava', boss: 'lava_golem', bspd: 1.1, elite: 0.12, hpMul: 1.3,
      affixes: ['berserk', 'shielded', 'splitter', 'vampiric', 'volatile'], wave: [3, 5], waves: [2, 3],
      pool: [ { type: 'boar', w: 2, from: 0 }, { type: 'archer', w: 2, from: 0 }, { type: 'shroom', w: 1, from: 0 },
              { type: 'guard', w: 2, from: 0 }, { type: 'imp', w: 3, from: 0 }, { type: 'mole', w: 2, from: 0 },
              { type: 'turret', w: 2, from: 1 }, { type: 'toad', w: 2, from: 0 }, { type: 'shaman', w: 1, from: 1 },
              { type: 'slime', w: 1, from: 0 }, { type: 'bat', w: 1, from: 0 } ] },
    { name: '深渊神殿', theme: 'abyss', boss: 'abyss_eye', bspd: 1.2, elite: 0.2, hpMul: 1.9,
      affixes: ['berserk', 'shielded', 'splitter', 'vampiric', 'volatile'], wave: [4, 6], waves: [2, 3],
      pool: [ { type: 'wraith', w: 3, from: 0 }, { type: 'abyss_knight', w: 2, from: 0 }, { type: 'sniper', w: 2, from: 0 },
              { type: 'priest', w: 2, from: 1 }, { type: 'guard', w: 2, from: 0 }, { type: 'imp', w: 2, from: 0 },
              { type: 'shaman', w: 1, from: 1 }, { type: 'toad', w: 1, from: 0 }, { type: 'mole', w: 1, from: 0 },
              { type: 'turret', w: 1, from: 0 }, { type: 'archer', w: 1, from: 0 } ] }
  ];
})(window.Game = window.Game || {});
