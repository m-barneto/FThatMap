import { ILogger } from "@spt/models/spt/utils/ILogger";
import { VFS } from "@spt/utils/VFS";
import fs from "fs";
import path from "path";

export interface Zones {
    bigmap: string[];
    factory4_day: string[];
    factory4_night: string[];
    interchange: string[];
    laboratory: string[];
    lighthouse: string[];
    rezervbase: string[];
    sandbox: string[];
    sandbox_high: string[];
    shoreline: string[];
    tarkovstreets: string[];
    woods: string[];
}



const modsFolderPath = path.normalize(path.join(__dirname, "..", ".."));
const vcqlZonesPath = "Virtual's Custom Quest Loader/database/zones/";



function loadFiles(dirPath, extName, cb, logger: ILogger) {
    logger.info(modsFolderPath);
    if (!fs.existsSync(dirPath)) return;
    logger.info(dirPath);
    const dir = fs.readdirSync(dirPath, { withFileTypes: true });
    dir.forEach(item => {
        const itemPath = path.normalize(`${dirPath}/${item.name}`);
        logger.info(itemPath);
        if (item.isDirectory()) this.loadFiles(itemPath, extName, cb);
        else if (extName.includes(path.extname(item.name))) cb(itemPath);
    });
}

export function getZones(vfs: VFS, logger: ILogger): Zones {
    const zones: Zones = JSON.parse(vfs.readFile(path.join(__dirname, "..", "res/zones.json")));
    const mapNames = Object.keys(zones);
    // const zones = [];
    // loadFiles(path.join(modPath, vcqlZonesPath), [".json"], function(filePath) {
    //     const zoneFile = vfs.readFile(path.resolve(filePath));
    //     logger.info(filePath);
    //     if (Object.keys(zoneFile).length > 0)
    //         zones.push(... zoneFile);
    // }, logger);
    return zones;
}