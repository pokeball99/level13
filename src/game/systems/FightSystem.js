// A system that handles fights. A fight is started by creating a FightNode and ended by this system.
define([
    'ash',
    'game/GameGlobals',
    'game/GlobalSignals',
    'game/constants/FightConstants',
    'game/constants/PositionConstants',
    'game/constants/EnemyConstants',
    'game/nodes/FightNode',
    'game/nodes/player/PlayerStatsNode',
    'game/components/common/PositionComponent',
    'game/components/sector/FightComponent',
    'game/components/sector/FightEncounterComponent',
    'game/components/sector/SectorControlComponent',
    'game/components/player/ItemsComponent',
    'game/components/player/PlayerActionResultComponent',
], function (Ash, GameGlobals, GlobalSignals, FightConstants, PositionConstants, EnemyConstants,
    FightNode, PlayerStatsNode,
    PositionComponent,
    FightComponent, FightEncounterComponent, SectorControlComponent,
    ItemsComponent, PlayerActionResultComponent) {
	
    var FightSystem = Ash.System.extend({
        
		fightNodes: null,
        playerStatsNodes: null,
        
        constructor: function () { },

        addToEngine: function (engine) {
			this.engine = engine;
            this.playerStatsNodes = engine.getNodeList(PlayerStatsNode);
            this.fightNodes = engine.getNodeList(FightNode);
            this.fightNodes.nodeAdded.add(this.onFightNodeAdded, this);
        },

        removeFromEngine: function (engine) {
			this.engine = null;
            this.fightNodes.nodeAdded.remove(this.onFightNodeAdded, this);
            this.playerStatsNodes = null;
            this.fightNodes = null;
        },
        
        onFightNodeAdded: function (node) {
            this.initFight();
        },

        update: function (time) {
            if (!this.fightNodes.head) return;
            if (this.fightNodes.head.fight.finished) return;
            if (this.fightNodes.head.fight.fled) return;
            
            var enemy = this.fightNodes.head.fight.enemy;
            var playerStamina = this.playerStatsNodes.head.stamina;
            var itemEffects = this.fightNodes.head.fight.itemEffects;
            
            if (itemEffects.fled) {
                this.fleeFight();
            }
            
            if (enemy.hp < 0 || playerStamina.hp < 0) {
                this.endFight();
            }
            
            this.applyFightStep(time);
        },
        
        initFight: function () {
            var enemy = this.fightNodes.head.fight.enemy;
            this.fightNodes.head.fight.nextTurnEnemy = FightConstants.getEnemyAttackTime(enemy) * Math.random();
            this.fightNodes.head.fight.nextTurnPlayer = FightConstants.getPlayerAttackTime() * Math.random();
        },
        
        applyFightStep: function (time) {
            var fightTime = Math.min(time, 1);
            
            var itemsComponent = this.playerStatsNodes.head.entity.get(ItemsComponent);
            var enemy = this.fightNodes.head.fight.enemy;
            var playerStamina = this.playerStatsNodes.head.stamina;
            var itemEffects = this.fightNodes.head.fight.itemEffects;
            
            // item effects: stun
            itemEffects.enemyStunnedSeconds -= fightTime;
            itemEffects.enemyStunnedSeconds = Math.max(itemEffects.enemyStunnedSeconds, 0);
            
            // enemy turn
            var playerDamage = 0;
            var playerRandomDamage = 0;
            if (itemEffects.enemyStunnedSeconds <= 0) {
                this.fightNodes.head.fight.nextTurnEnemy -= fightTime;
                if (this.fightNodes.head.fight.nextTurnEnemy <= 0) {
                    playerDamage = FightConstants.getPlayerDamagePerAttack(enemy, playerStamina, itemsComponent);
                    playerRandomDamage = FightConstants.getRandomDamagePerAttack(enemy, playerStamina, itemsComponent);
                    this.fightNodes.head.fight.nextTurnEnemy = FightConstants.getEnemyAttackTime(enemy);
                }
            }
            
            // player turn
            var enemyDamage = 0;
            this.fightNodes.head.fight.nextTurnPlayer -= fightTime;
            if (this.fightNodes.head.fight.nextTurnPlayer <= 0) {
                enemyDamage = FightConstants.getEnemyDamagePerAttack(enemy, playerStamina, itemsComponent);
                this.fightNodes.head.fight.nextTurnPlayer = FightConstants.getPlayerAttackTime();
            }
            
            // item effects: extra damage
            var extraEnemyDamage = 0;
            if (itemEffects.damage > 0) {
                extraEnemyDamage += itemEffects.damage;
                itemEffects.damage = 0;
            }

            // apply effects
            var enemyChange = enemyDamage + extraEnemyDamage;
            enemy.hp -= enemyChange;
            var playerChange = playerDamage + playerRandomDamage;
            playerStamina.hp -= playerChange;
            
            if (playerChange !== 0 || enemyChange !== 0) {
                log.i("fight update: " + enemyChange + " " + playerChange, this)
                GlobalSignals.fightUpdateSignal.dispatch();
            }
        },
        
        endFight: function () {
            var sector = this.fightNodes.head.entity;
            var enemy = this.fightNodes.head.fight.enemy;
            var playerStamina = this.playerStatsNodes.head.stamina;
            var won = playerStamina.hp > enemy.hp;
            var cleared = false;
            
            if (won) {
                var sectorControlComponent = sector.get(SectorControlComponent);
				var encounterComponent = sector.get(FightEncounterComponent);
				var baseActionID = GameGlobals.playerActionsHelper.getBaseActionID(encounterComponent.context);
				var localeId = FightConstants.getEnemyLocaleId(baseActionID, encounterComponent.context);
				sectorControlComponent.addWin(localeId);
				
				var relatedSectorDirection = FightConstants.getRelatedSectorDirection(baseActionID, encounterComponent.context);
				if (relatedSectorDirection !== PositionConstants.DIRECTION_NONE) {
					var relatedSectorPosition = PositionConstants.getPositionOnPath(sector.get(PositionComponent).getPosition(), relatedSectorDirection, 1);
					var relatedSector = GameGlobals.levelHelper.getSectorByPosition(relatedSectorPosition.level, relatedSectorPosition.sectorX, relatedSectorPosition.sectorY);
					var relatedSectorControlComponent = relatedSector.get(SectorControlComponent);
					var relatedSectorLocaleId = FightConstants.getEnemyLocaleId(baseActionID, encounterComponent.context, true);
					relatedSectorControlComponent.addWin(relatedSectorLocaleId);
				}
            }
            
            this.fightNodes.head.fight.resultVO = GameGlobals.playerActionResultsHelper.getFightRewards(won);
            this.playerStatsNodes.head.entity.add(new PlayerActionResultComponent(this.fightNodes.head.fight.resultVO));
            
            enemy.hp = 100;
            playerStamina.hp = 100;
            this.fightNodes.head.fight.won = won;
            this.fightNodes.head.fight.finished = true;
        },
        
        fleeFight: function () {
            this.fightNodes.head.fight.fled = true;
        },
        
    });

    return FightSystem;
});
