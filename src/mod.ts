import { DependencyContainer } from "tsyringe";

import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { IDatabaseTables } from "@spt/models/spt/server/IDatabaseTables";
import { VFS } from "@spt/utils/VFS";
import path from "node:path";
import { ILocations } from "@spt/models/spt/server/ILocations";
import { ILocation } from "@spt/models/eft/common/ILocation";
import { jsonc } from "jsonc";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { IQuest } from "@spt/models/eft/common/tables/IQuest";
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

    preSptLoad(container: DependencyContainer): void {
        this.logger = container.resolve<ILogger>("WinstonLogger");
        container.register<QuestControllerExtension>("QuestControllerExtension", QuestControllerExtension);
        container.register("QuestController", {useToken: "QuestControllerExtension"});
    }

    public postDBLoad(container: DependencyContainer): void {
        const vfs = container.resolve<VFS>("VFS");
        this.modConfig = jsonc.parse(vfs.readFile(path.resolve(__dirname, "../config/config.jsonc")));

        this.zones = getZones(vfs, this.logger);

        const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const tables: IDatabaseTables = databaseServer.getTables();
        this.maps = tables.locations;
        this.locale = tables.locales.global["en"];

        const mapIdsToRemove: string[] = [];

        // Loop through all the maps we have in config and make sure they exist...
        this.modConfig.RemoveQuestsOnMaps.forEach(mapName => {
            if (!(mapName in this.maps)) {
                this.logger.error(`Unable to find map ${mapName}! Make sure you're spelling the map id correctly, see the config for valid entries.`);
                return;
            }
            mapIdsToRemove.push((this.maps[mapName] as ILocation).base._Id);
        });
        this.logger.success("Found all maps in config!");
        mapIdsToRemove.forEach(mapid => {
            this.logger.success(mapid);
        })


        Mod.conditionsToSkip = [];
        const quests: Record<string, IQuest> = tables.templates.quests;
        // Loop through quests
        for (const questId in quests) {
            const quest: IQuest = quests[questId];
            //this.logger.success(`Quest: ${quest.QuestName}`);
            quest.conditions.AvailableForFinish.forEach(condition => {
                // if (condition.zoneId) {
                //     if (!this.zoneExists(condition.zoneId)) {
                //         this.logger.success(`Missing: ${condition.zoneId}`);
                //     }
                // }
                const conditionText = this.locale[condition.id];
                const conditionMap = this.getMapIdFromString(conditionText);
                if (conditionMap !== undefined) {
                    if (mapIdsToRemove.includes(conditionMap)) {
                        this.logger.success(`Pushing ${quest.QuestName} condition for map ${conditionMap}`);
                        Mod.conditionsToSkip.push(condition.id);
                    }
                }
            });
        }
    }

    // zoneExists(zone: string) {
    //     const mapNames = Object.keys(this.zones);
    //     for (const i in mapNames) {
    //         const mapName = mapNames[i];
    //         if (this.zones[mapName].includes(zone)) return true;
    //     }
    //     return false;
    // }

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
}

export const mod = new Mod();
