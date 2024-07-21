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

interface ModConfig {
    RemoveQuestsOnMaps: string[];
}

class Mod implements IPostDBLoadMod {
    private modConfig: ModConfig;
    private logger: ILogger;

    public postDBLoad(container: DependencyContainer): void {
        const vfs = container.resolve<VFS>("VFS");
        this.modConfig = jsonc.parse(vfs.readFile(path.resolve(__dirname, "../config/config.jsonc")));

        this.logger = container.resolve<ILogger>("WinstonLogger");
        
        const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const tables: IDatabaseTables = databaseServer.getTables();
        const maps: ILocations = tables.locations;

        // Loop through all the maps we have in config and make sure they exist...
        this.modConfig.RemoveQuestsOnMaps.forEach(mapName => {
            if (!(mapName in maps)) {
                this.logger.error(`Unable to find map ${mapName}! Make sure you're spelling the map id correctly, see the config for valid entries.`);
                return;
            }
        });
        this.logger.success("Found all maps in config!");

        // 
        
    }
}

export const mod = new Mod();
