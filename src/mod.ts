import { DependencyContainer } from "tsyringe";

import { IPostDBLoadMod } from "@spt/models/external/IPostDBLoadMod";
import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { IDatabaseTables } from "@spt/models/spt/server/IDatabaseTables";
import { VFS } from "@spt/utils/VFS";
import path from "node:path";
import { ILocations } from "@spt/models/spt/server/ILocations";
import { ILocation } from "@spt/models/eft/common/ILocation";
import { jsonc } from "jsonc";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { IQuest } from "@spt/models/eft/common/tables/IQuest";
import { StaticRouterModService } from "@spt/services/mod/staticRouter/StaticRouterModService";
import { getZones, Zones } from "./ZoneManager";

interface ModConfig {
    RemoveQuestsOnMaps: string[];
}

class Mod implements IPostDBLoadMod {
    private modConfig: ModConfig;
    private logger: ILogger;
    private zones: Zones;

    public postDBLoad(container: DependencyContainer): void {
        const vfs = container.resolve<VFS>("VFS");
        this.modConfig = jsonc.parse(vfs.readFile(path.resolve(__dirname, "../config/config.jsonc")));

        this.logger = container.resolve<ILogger>("WinstonLogger");

        this.zones = getZones(vfs, this.logger);

        const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const tables: IDatabaseTables = databaseServer.getTables();
        const maps: ILocations = tables.locations;

        const mapIdsToRemove: string[] = [];

        // Loop through all the maps we have in config and make sure they exist...
        this.modConfig.RemoveQuestsOnMaps.forEach(mapName => {
            if (!(mapName in maps)) {
                this.logger.error(`Unable to find map ${mapName}! Make sure you're spelling the map id correctly, see the config for valid entries.`);
                return;
            }
            mapIdsToRemove.push((maps[mapName] as ILocation).base._Id);
        });
        this.logger.success("Found all maps in config!");

        const quests: Record<string, IQuest> = tables.templates.quests;

        // Loop through quests
        for (const questId in quests) {
            const quest: IQuest = quests[questId];
            //this.logger.success(`Quest: ${quest.QuestName}`);
            if (true) { //|| quest.location === "any" || mapIdsToRemove.includes(quest.location)
                //this.logger.success(`raaaa ${quest.location}`);
                quest.conditions.AvailableForFinish.forEach(condition => {
                    this.logger.success(condition.type);
                    if (condition.zoneId) {
                        if (!this.zoneExists(condition.zoneId)) {
                            this.logger.success(`Missing: ${condition.zoneId}`);
                            quest.conditions.AvailableForFinish.forEach(condition => {
                                this.logger.error(`${quest.QuestName}:${condition.conditionType} | ${condition.zoneId}`);
                            });
                        }
                    }
                });
            }
        }
    }

    zoneExists(zone: string) {
        const mapNames = Object.keys(this.zones);
        for (const i in mapNames) {
            const mapName = mapNames[i];
            if (this.zones[mapName].includes(zone)) return true;
        }
        return false;
    }
}

export const mod = new Mod();
