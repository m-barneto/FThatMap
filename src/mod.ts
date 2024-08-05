import { DependencyContainer } from "tsyringe";

import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { IDatabaseTables } from "@spt/models/spt/server/IDatabaseTables";
import { VFS } from "@spt/utils/VFS";
import path from "node:path";
import { ILocations } from "@spt/models/spt/server/ILocations";
import { ILocation } from "@spt/models/eft/common/ILocation";
import { jsonc } from "jsonc";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { IQuest, IQuestCondition } from "@spt/models/eft/common/tables/IQuest";
import { getZones, Zones } from "./ZoneManager";
import { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import { QuestControllerExtension } from "./QuestControllerExtension";
import { IPostDBLoadMod } from "@spt/models/external/IPostDBLoadMod";

interface ModConfig {
    RemoveQuestsOnMaps: string[];
}

export class Mod implements IPreSptLoadMod, IPostDBLoadMod {

    private modConfig: ModConfig;
    private logger: ILogger;
    private zones: Zones;
    private locale: Record<string, string>;
    private maps: ILocations;
    public static conditionsToSkip: string[];
    private mapIdsToRemove: string[];

    // Associate quest item ids with a location
    private questItemLocations: Record<string, string>;

    preSptLoad(container: DependencyContainer): void {
        this.logger = container.resolve<ILogger>("WinstonLogger");
        // container.register<QuestControllerExtension>("QuestControllerExtension", QuestControllerExtension);
        // container.register("QuestController", {useToken: "QuestControllerExtension"});
    }

    public postDBLoad(container: DependencyContainer): void {
        const vfs = container.resolve<VFS>("VFS");
        this.modConfig = jsonc.parse(vfs.readFile(path.resolve(__dirname, "../config/config.jsonc")));

        this.zones = getZones(vfs, this.logger);

        const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const tables: IDatabaseTables = databaseServer.getTables();
        this.maps = tables.locations;
        this.locale = tables.locales.global["en"];

        this.mapIdsToRemove = [];

        // Loop through all the maps we have in config and make sure they exist...
        this.modConfig.RemoveQuestsOnMaps.forEach(mapName => {
            if (!(mapName in this.maps)) {
                this.logger.error(`Unable to find map ${mapName}! Make sure you're spelling the map id correctly, see the config for valid entries.`);
                return;
            }
            this.mapIdsToRemove.push((this.maps[mapName] as ILocation).base._Id);
        });
        this.logger.success("Found all maps in config!");



        this.questItemLocations = {};
        Mod.conditionsToSkip = [];
        const quests: Record<string, IQuest> = tables.templates.quests;
        // Loop through quests
        for (const questId in quests) {
            const quest: IQuest = quests[questId];
            //this.logger.success(`Quest: ${quest.QuestName}`);
            quest.conditions.AvailableForFinish.forEach(condition => {

                if (this.shouldCompleteCondition(condition)) {
                    this.completeCondition(condition);
                }

                return;
                // if (condition.zoneId) {
                //     if (!this.zoneExists(condition.zoneId)) {
                //         this.logger.success(`Missing: ${condition.zoneId}`);
                //     }
                // }
                const conditionText = this.locale[condition.id];
                const conditionMap = this.getMapIdFromString(conditionText);
                if (conditionMap !== undefined) {
                    if (this.mapIdsToRemove.includes(conditionMap)) {
                        this.logger.success(`Pushing ${quest.QuestName} condition for map ${conditionMap}`);
                        Mod.conditionsToSkip.push(condition.id);
                        if (typeof condition.value === "number") {
                            condition.value = 0;
                        }
                    }
                }
            });
        }
    }

    shouldCompleteCondition(condition: IQuestCondition): boolean {
        let hasMapName = false;
        const conditionMap = this.getMapIdFromString(this.locale[condition.id]);
        if (conditionMap !== undefined && this.mapIdsToRemove.includes(conditionMap)) {
            hasMapName = true;
        }
        let shouldComplete = hasMapName;
        switch (condition.conditionType) {
            case "Quest":
            case "Skill":
            case "WeaponAssembly":
            case "TraderLoyalty":
                break;
            case "CounterCreator":
                // Counter creator's need checks as not all will be caught by name check (extract from location for example)
                for (const i in condition.counter.conditions) {
                    const counterCondition = condition.counter.conditions[i];
                    if (counterCondition.conditionType === "Location") {
                        let allMapsRemoved = true;
                        for (const j in counterCondition.target as string[]) {
                            const targetMapName = counterCondition.target[j];
                            const mapIdFound = this.getMapIdFromString(targetMapName);
                            if (mapIdFound == undefined) {
                                this.logger.error(`${targetMapName} could not be correlated to a map id`);
                            } else if (!this.isMapIdRemoved(mapIdFound)) {
                                allMapsRemoved = false;
                            }
                        }

                        if (allMapsRemoved) {
                            shouldComplete = true;
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
                        if (this.isMapIdRemoved(this.questItemLocations[targetId])) {
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
                } else {
                    this.logger.error(`FindItem ${condition.id} doesn't have a map name associated?`);
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
                        if (this.isMapIdRemoved(this.questItemLocations[targetId])) {
                            shouldComplete = true;
                        }
                    }
                }

                const mapId = this.getMapIdFromZoneId(condition.zoneId);
                if (this.isMapIdRemoved(mapId)) shouldComplete = true;
                break;
            }
            case "PlaceBeacon":

                break;
            default:
                break;
        }

        return shouldComplete;
    }

    completeCondition(condition: IQuestCondition): void {
        if (condition.conditionType == undefined) {
            this.logger.error(`Condition ${condition.id} has no conditiontype???`);
            return;
        }

    }

    isMapIdRemoved(mapId: string): boolean {
        return this.mapIdsToRemove.includes(mapId);
    }

    // zoneExists(zone: string) {
    //     const mapNames = Object.keys(this.zones);
    //     for (const i in mapNames) {
    //         const mapName = mapNames[i];
    //         if (this.zones[mapName].includes(zone)) return true;
    //     }
    //     return false;
    // }

    getMapIdFromName(name: string): string {
        let mapId = "";

        return mapId;
    }

    // These need to be better named
    // convert from display name to shortname
    // convert from shortname to _id

    getMapFromConditionText(text: string): string {
        return "";
    }

    getMapFromId(mapId: string): string {
        return "";
    }

    getLocationByMapName(mapName: string): string {
        
    }

    getMapIdFromString(text: string) {
        const sep = text.split("on ");
        text = sep[sep.length - 1].toLowerCase();
        //let foundMaps = [];

        const entries = Object.entries(this.maps);
        let mapId = undefined;
        entries.forEach(([key, value]) => {
            if (key == "base" || key == "hideout" || key == "factory4_night" || key == "terminal") return;

            const map: ILocation = value;

            let mapName = map.base.Name.toLowerCase();
            if (key == "sandbox" || key == "sandbox_high") {
                mapName = "ground zero";
            } else if (key == "reservebase") {
                mapName = "reserve";
            }

            
            if (text.indexOf(mapName) != -1) {
                mapId = map.base._Id;
                return;
            }
        });
        
        // if (foundMaps.length > 1) {
        //     this.logger.error(`MORE THAN 1 MAP FOUND IN ${text}`);
        //     foundMaps.forEach(val => {
        //         this.logger.error(val);
        //     })
        // }
        return mapId;
    }

    getMapIdFromZoneId(zoneId: string): string {
        const mapNames = Object.keys(this.zones);
        for (const i in mapNames) {
            const mapName = mapNames[i];
            if (this.zones[mapName].includes(zoneId)) return (this.maps[mapName] as ILocation).base._Id;
        }
        this.logger.error(`${zoneId} doesn't have an associated map!`);
        return undefined;
    }
}

export const mod = new Mod();
