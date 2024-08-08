import { DependencyContainer } from "tsyringe";

import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { IDatabaseTables } from "@spt/models/spt/server/IDatabaseTables";
import { VFS } from "@spt/utils/VFS";
import path from "node:path";
import { ILocation } from "@spt/models/eft/common/ILocation";
import { jsonc } from "jsonc";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { IQuest, IQuestCondition } from "@spt/models/eft/common/tables/IQuest";
import { getZones, Zones } from "./ZoneManager";
import { IPostDBLoadMod } from "@spt/models/external/IPostDBLoadMod";

interface ModConfig {
    RemoveQuestsOnMaps: string[];
}

export class FThatMap implements IPostDBLoadMod {

    private modConfig: ModConfig;
    private logger: ILogger;
    private zones: Zones;
    private locale: Record<string, string>;
    private maps: Record<string, ILocation>;
    private mapIdToName: Record<string, string>;
    private completedConditionIds: string[];

    // Associate quest item ids with a location
    private questItemLocations: Record<string, string>;

    public postDBLoad(container: DependencyContainer): void {
        // Setup logger
        this.logger = container.resolve<ILogger>("WinstonLogger");
        // Grab what we need from the server database
        const tables: IDatabaseTables = container.resolve<DatabaseServer>("DatabaseServer").getTables();
        const quests: Record<string, IQuest> = tables.templates.quests;
        // Setup up our locales (change key to lower to avoid an issue with mismatched quest -> locale ids)
        this.locale = {};
        for (const localeId in tables.locales.global["en"]) {
            this.locale[localeId.toLowerCase()] = tables.locales.global["en"][localeId];
        }

        // Load our mod config
        const vfs = container.resolve<VFS>("VFS");
        this.modConfig = jsonc.parse(vfs.readFile(path.resolve(__dirname, "../config/config.jsonc")));

        // Load in the zones, as well as zones added by VCQL (TODO)
        this.zones = getZones(vfs, this.logger);


        // Setup our mapname to location dictionary
        this.maps = {};
        const mapKeys = Object.keys(tables.locations);
        for (const i in mapKeys) {
            const mapName = mapKeys[i];
            if (mapName === "base" || mapName === "hideout") continue;
            this.maps[mapName] = tables.locations[mapName];
        }

        // Setup out mapId to name dict
        this.mapIdToName = {};
        for (const mapId in this.maps) {
            let mapName = this.maps[mapId].base.Name.toLowerCase();

            // Handle special cases
            if (mapName === "sandbox") {
                mapName = "ground zero";
            } else if (mapName === "reservebase") {
                mapName = "reserve";
            }

            // Add our entry
            this.mapIdToName[mapId] = mapName;
        }
        

        // Initialize quest item to mapname linking before iterating over quests
        this.questItemLocations = {};
        // Initialize completed condition list before iterating over quests.
        this.completedConditionIds = [];
        // Loop through quests
        for (const i in quests) {
            const quest: IQuest = quests[i];

            let findItemCondition: IQuestCondition = undefined;
            let leaveItemCondition: IQuestCondition = undefined;
            
            // Iterate over all quest conditions
            for (const j in quest.conditions.AvailableForFinish) {
                const condition = quest.conditions.AvailableForFinish[j];
                if (condition.conditionType === "FindItem") {
                    findItemCondition = condition;
                } else if (condition.conditionType === "LeaveItemAtLocation") {
                    leaveItemCondition = condition;
                }
                // Should complete condition also grabs info we need from the condition for questItemLocations
                if (this.shouldCompleteCondition(condition)) {
                    // Add condition id to our list
                    this.completedConditionIds.push(condition.id.toLowerCase());
                    // If it returns true then we want to set this condition as completed
                    this.completeCondition(condition);
                }
            }

            // TODO handle finditem and plantitem on differing maps (if one is "removed", then set both conditions to completed)
            if (findItemCondition !== undefined && leaveItemCondition !== undefined) {
                if (this.shouldCompleteCondition(leaveItemCondition)) {
                    // check leave item condition for source item
                    for (const j in leaveItemCondition.target as string[]) {
                        const leftItem = leaveItemCondition.target[j];
    
                        if (findItemCondition.target.includes(leftItem) && !this.completedConditionIds.includes(findItemCondition.id)) {
                            // set findItemCondition to completed
                            this.completeCondition(findItemCondition);
                        }
                    }
                }
            }
        }
    }

    shouldCompleteCondition(condition: IQuestCondition): boolean {
        let hasMapName = false;
        const conditionMap = this.getMapNameFromConditionText(this.locale[condition.id.toLowerCase()]);
        if (conditionMap !== undefined && this.modConfig.RemoveQuestsOnMaps.includes(conditionMap)) {
            hasMapName = true;
        }
        let shouldComplete = hasMapName;

        if (!shouldComplete && condition.visibilityConditions?.length > 0) {
            let allComplete = true;
            for (const i in condition.visibilityConditions) {
                const visCondition = condition.visibilityConditions[i];
                if (!this.completedConditionIds.includes(visCondition.target)) {
                    allComplete = false;
                    break;
                }
            }
            shouldComplete = allComplete;
        }


        switch (condition.conditionType) {
            case "CounterCreator":
                // Counter creator's need checks as not all will be caught by name check (extract from location for example)
                for (const i in condition.counter.conditions) {
                    const counterCondition = condition.counter.conditions[i];
                    if (counterCondition.conditionType === "Location") {
                        for (const j in counterCondition.target as string[]) {
                            const targetMapId = counterCondition.target[j].toLowerCase();
                            const isTargetMap = this.isMapName(this.getMapNameFromId(targetMapId));
                            if (isTargetMap && this.modConfig.RemoveQuestsOnMaps.includes(this.getMapNameFromId(targetMapId))) {
                                //this.logger.warning("Thing ");
                                shouldComplete = true;
                                break;
                            }
                        }
                    } else if (counterCondition.conditionType === "VisitPlace") {
                        const zoneMap = this.getMapNameFromZoneId(counterCondition.target as string);
                        if (this.modConfig.RemoveQuestsOnMaps.includes(zoneMap)) {
                            shouldComplete = true;
                            break;
                        }
                    }
                }
                break;
            case "HandoverItem":
                // Go through the targets
                for (const i in condition.target as string[]) {
                    const targetId = condition.target[i];
                    // If the id is in our thingy mabober
                    if (targetId in this.questItemLocations) {
                        // and the map is forbidden 
                        if (this.modConfig.RemoveQuestsOnMaps.includes(this.questItemLocations[targetId])) {
                            shouldComplete = true;
                        }
                    }
                }
                break;
            case "FindItem":
                // If it has mapname, associate the item with that location
                if (hasMapName) {
                    for (const i in condition.target as string[]) {
                        const targetId = condition.target[i];
                        this.questItemLocations[targetId] = conditionMap;
                    }
                }
                break;
            case "LeaveItemAtLocation": {
                // If it has mapname, cancel it
                
                // Also check if the associated maps are on the list and cancel it if so
                //const sourceMapId = this.questItemLocations[condition.target]
                // Go through the targets
                for (const i in condition.target as string[]) {
                    const targetId = condition.target[i];
                    if (targetId in this.questItemLocations) {
                        if (this.modConfig.RemoveQuestsOnMaps.includes(this.questItemLocations[targetId])) {
                            shouldComplete = true;
                        }
                    }
                }

                const zoneMap = this.getMapNameFromZoneId(condition.zoneId);
                if (this.modConfig.RemoveQuestsOnMaps.includes(zoneMap)) {
                    shouldComplete = true;
                }
                break;
            }
            case "PlaceBeacon": {
                const zoneMap = this.getMapNameFromZoneId(condition.zoneId);
                if (this.modConfig.RemoveQuestsOnMaps.includes(zoneMap)) {
                    shouldComplete = true;
                }
                break;
            }
            case "Quest":
            case "Skill":
            case "WeaponAssembly":
            case "TraderLoyalty":
            default:
                break;
        }

        return shouldComplete;
    }

    completeCondition(condition: IQuestCondition): void {
        if (condition.conditionType == undefined) {
            return;
        }
        condition.value = 0;
    }

    getMapNameFromConditionText(text: string): string | undefined {
        for (const mapId in this.mapIdToName) {
            const mapName = this.mapIdToName[mapId];
            if (text.toLowerCase().indexOf(mapName) !== -1) {
                return mapId;
            }
        }
        return undefined;
    }

    getMapNameFromId(mapId: string): string | undefined {
        for (const mapName in this.maps) {
            const mapInfo = this.getLocationByMapName(mapName);
            if (mapInfo.base._Id === mapId) return mapName;
        }
        return undefined;
    }

    getLocationByMapName(mapName: string): ILocation | undefined {
        return this.maps[mapName];
    }

    isMapName(mapName: string): boolean {
        return mapName in this.maps;
    }

    getMapNameFromZoneId(zoneId: string): string {
        for (const mapName in this.maps) {
            if (this.zones[mapName]?.includes(zoneId)) {
                return mapName;
            }
        }
        return undefined;
    }
}

export const mod = new FThatMap();
