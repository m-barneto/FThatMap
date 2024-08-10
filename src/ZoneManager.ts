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


interface ZoneFile {
    ZoneId: string;
    ZoneName: string;
    ZoneLocation: string;
    ZoneType: string;
    FlareType: string;
    Position: Position;
    Rotation: Position;
    Scale: Position;
}

interface Position {
    X: string;
    Y: string;
    Z: string;
    W: string;
}


const modsFolderPath = path.normalize(path.join(__dirname, "..", ".."));
const vcqlZonesPath = "Virtual's Custom Quest Loader/database/zones/";



function loadFiles(dirPath, extName, cb) {
    if (!fs.existsSync(dirPath)) return;
    const dir = fs.readdirSync(dirPath, { withFileTypes: true });
    dir.forEach(item => {
        const itemPath = path.normalize(`${dirPath}/${item.name}`);
        if (item.isDirectory()) this.loadFiles(itemPath, extName, cb);
        else if (extName.includes(path.extname(item.name))) cb(itemPath);
    });
}

export function getZones(vfs: VFS, hasVcql: boolean): Zones {
    const zones: Zones = JSON.parse(vfs.readFile(path.join(__dirname, "..", "res/zones.json")));
    if (!hasVcql) return zones;
    
    loadFiles(path.join(modsFolderPath, vcqlZonesPath), [".json"], function(filePath) {
        const zoneFile = vfs.readFile(path.resolve(filePath));
        const zoneJson = JSON.parse(zoneFile) as ZoneFile[];
        for (const i in zoneJson) {
            const zone = zoneJson[i];
            if (zone.ZoneLocation.toLowerCase() in zones) {
                zones[zone.ZoneLocation.toLowerCase()].push(zone.ZoneId);
            }
        }
    });
    return zones;
}