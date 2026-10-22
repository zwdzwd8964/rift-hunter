// 角色、难度、经济常量（模拟层数据）。
(function (G) {
  'use strict';
  // hp：生命（1 颗心 = 2 点）；shield：护盾格；energy：能量上限；spd：移速（像素/秒）
  G.CHARS = {
    ranger: {
      name: '游侠', color: '#63c74d', hp: 6, shield: 2, energy: 160, spd: 180, weapon: 'pistol', cost: 0,
      skill: { name: '疾风连射', cd: 9, dur: 4, desc: '4 秒内射速翻倍，翻滚无冷却。' },
      passive: { name: '猎手直觉', desc: '翻滚后 1 秒内暴击率 +30%。' },
      desc: '身手敏捷的裂隙猎人，攻守均衡，适合新手。'
    },
    mage: {
      name: '冰法师', color: '#2ce8f5', hp: 5, shield: 3, energy: 220, spd: 172, weapon: 'frost_wand', cost: 60,
      skill: { name: '冰霜新星', cd: 10, dur: 0, desc: '冻结周围敌人 3 秒并造成伤害，清除附近敌弹。' },
      passive: { name: '寒意', desc: '攻击有 15% 几率使敌人减速。' },
      desc: '操纵寒冰的学者，护盾更厚，擅长控场。'
    },
    knight: {
      name: '重装骑士', color: '#feae34', hp: 8, shield: 2, energy: 140, spd: 165, weapon: 'shotgun', cost: 100,
      skill: { name: '钢铁壁垒', cd: 12, dur: 2.5, desc: '2.5 秒内免疫伤害并吸收敌弹，结束时向四周反射。' },
      passive: { name: '坚毅', desc: '护盾回复速度 +50%。' },
      desc: '身披重甲的老兵，生命最高，近距离火力凶猛。'
    },
    alchemist: {
      name: '炼金师', color: '#b55088', hp: 5, shield: 2, energy: 200, spd: 175, weapon: 'flask_sling', cost: 150,
      skill: { name: '剧毒迷雾', cd: 10, dur: 0, desc: '在瞄准处释放大范围毒雾，持续伤害并减速敌人。' },
      passive: { name: '毒素专精', desc: '中毒伤害 +50%，中毒的敌人死亡时回复 3 点能量。' },
      desc: '危险的药剂师，用毒雾和爆炸瓶削弱成群的敌人。'
    }
  };
  G.CHAR_ORDER = ['ranger', 'mage', 'knight', 'alchemist'];

  // 难度：ehp 敌人血量、count 数量、bspd 敌弹速、tele 预警时长（结果仍 ≥0.5s）、heavy 精英/Boss 造成 2 点伤害、php 玩家额外生命、crystal 魂晶倍率
  G.DIFFS = {
    casual: { name: '休闲', desc: '第一次玩动作游戏？选这个：敌人更少更慢，预警更长，额外 +2 生命。', ehp: 0.8, count: 0.75, bspd: 0.82, tele: 1.3, heavy: false, php: 2, crystal: 0.7 },
    normal: { name: '普通', desc: '适合第一次游玩：标准体验，熟练后约 15 分钟一局。', ehp: 1, count: 1, bspd: 1, tele: 1, heavy: false, php: 0, crystal: 1 },
    hard: { name: '困难', desc: '为熟练猎人准备：敌人更多更耐打、弹速更快，精英与首领每次扣 1 颗心。', ehp: 1.25, count: 1.25, bspd: 1.2, tele: 0.85, heavy: true, php: 0, crystal: 1.4 }
  };
  G.DIFF_ORDER = ['casual', 'normal', 'hard'];

  // 经济与房间常量
  G.ECON = {
    startGold: 0,
    shop: { heart: 15, armor: 12, energy: 8, relic: [0, 38, 48, 60, 78, 100], weapon: [0, 24, 32, 44, 58, 76], floorAdd: 6 },
    altarBlood: 2,            // 血之祭坛：献祭 2 点生命（不会致死）
    altarGold: [40, 55, 70],  // 金之祭坛：按楼层
    roll: { dur: 0.28, mul: 2.55, cd: 0.8 },
    iframes: 1.0,
    shieldDelay: 5.0, shieldTick: 1.6,
    energyRegen: 4
  };
})(window.Game = window.Game || {});
