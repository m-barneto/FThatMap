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
import { PreSptModLoader } from "@spt/loaders/PreSptModLoader";
import { LogTextColor } from "@spt/models/spt/logging/LogTextColor";

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
    private modifiedQuests: number;
    private completedConditions: number;
    private debug: boolean;

    // Associate quest item ids with a location
    private questItemLocations: Record<string, string>;

    public postDBLoad(container: DependencyContainer): void {
        this.debug = true;
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

        // Check if VCQL is loaded
        const preSptModLoader = container.resolve<PreSptModLoader>("PreSptModLoader"); 
        const hasVcqlLoaded = preSptModLoader.getImportedModsNames().includes("Virtual's Custom Quest Loader");

        // Load in the zones, as well as zones added by VCQL (TODO)
        this.zones = getZones(vfs, hasVcqlLoaded);

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

        // Print out the configured maps if debugging
        if (this.debug) {
            this.logger.info("[FThatMap] Configured Maps")
            for (const i in this.modConfig.RemoveQuestsOnMaps) {
                const mapName = this.modConfig.RemoveQuestsOnMaps[i];
                this.logger.info(`[FThatMap] ${mapName}`);
            }
        }
        
        // Initialize our counter
        this.modifiedQuests = 0;

        // Initialize quest item to mapname linking before iterating over quests
        this.questItemLocations = {};
        // Initialize completed condition list before iterating over quests.
        this.completedConditionIds = [];
        
        // Loop through quests
        for (const i in quests) {
            const quest: IQuest = quests[i];

            if (this.debug) {
                this.logger.error(`[FThatMap] ${quest.QuestName}`);
            }

            let modified = false;

            let findItemCondition: IQuestCondition = undefined;
            let leaveItemCondition: IQuestCondition = undefined;

            // Keep track of previous condition
            let prevCondition = undefined;
            
            // Iterate over all quest conditions
            for (const j in quest.conditions.AvailableForFinish) {
                const condition = quest.conditions.AvailableForFinish[j];

                // Handle our linking of find and leave item conditions
                if (condition.conditionType === "FindItem") {
                    findItemCondition = condition;
                } else if (condition.conditionType === "LeaveItemAtLocation") {
                    leaveItemCondition = condition;
                }

                // Should complete condition also grabs info we need from the condition for questItemLocations
                if (this.shouldCompleteCondition(prevCondition, condition)) {
                    modified = true;
                    // If it returns true then we want to set this condition as completed
                    this.completeCondition(condition);
                    // Add condition id to our list
                    this.completedConditionIds.push(condition.id.toLowerCase());

                    if (this.debug) {
                        this.logger.success(`[FThatMap] ${this.locale[condition.id]}`);
                    }
                } else if (this.debug) {
                    this.logger.warning(`[FThatMap] ${this.locale[condition.id]}`);
                }

                prevCondition = condition;
            }

            // Handle finditem and plantitem on differing maps (if one is "removed", then set both conditions to completed)
            if (findItemCondition !== undefined && leaveItemCondition !== undefined) {
                // So we only care about completing find item because leave item gets handled properly by tracking finditem's target item
                if (this.shouldCompleteCondition(undefined, leaveItemCondition)) {
                    // check leave item condition for source item
                    for (const j in leaveItemCondition.target as string[]) {
                        const leftItem = leaveItemCondition.target[j];
                        
                        // If the find item is targetting our left item, and it's not on a removed map, complete the condition anyways (if it's on a removed map it would've already been completed)
                        if (findItemCondition.target.includes(leftItem) && !this.completedConditionIds.includes(findItemCondition.id)) {
                            // set findItemCondition to completed
                            this.completeCondition(findItemCondition);
                        }
                    }
                }
            }

            // Increment our counter if quest was modified.
            if (modified) {
                this.modifiedQuests++;
            }
        }

        // Print our loaded message
        this.logger.logWithColor(`Skipped ${this.completedConditionIds.length} quest conditions. Spanning a total of ${this.modifiedQuests} quests!`, LogTextColor.CYAN);
    }

    /**
     * Check if a condition needs to be completed.
     * @param condition indentified for completion
     * @returns 
     */
    shouldCompleteCondition(prevCondition: IQuestCondition, condition: IQuestCondition): boolean {
        // Check if condition id is present (IT SHOULD BE?)
        if (condition.id === undefined) {
            this.logger.error("Error with condition. Idk how to identify this condition to tell you because it's condition ID is undefined!");
            return false;
        }
        // Get locale
        const conditionText = this.locale[condition.id.toLowerCase()];
        // If no condition text was found, log an error and return false.
        if (conditionText === undefined) {
            this.logger.error(`Error finding locale for condition id ${condition.id}! Please report this!`);
            return false;
        }
        // Use the condition's locale to see if it contains a map name
        const conditionMap = this.getMapNameFromConditionText(conditionText);
        // If it does, then set hasMapName to true, that way it can be utilized in lower sections to correlate other info from the condition
        // If we just returned true here, we'd miss some edge cases related to quest items
        let hasMapName = false;
        if (conditionMap !== undefined && this.modConfig.RemoveQuestsOnMaps.includes(conditionMap)) {
            hasMapName = true;
        }
        

        let shouldComplete = hasMapName;
        // If we aren't already completing this condition, look at the conditions visibility conditions
        if (!shouldComplete && condition.visibilityConditions?.length > 0) {
            // Go through each vis condition and if any of them aren't completed, we want allComplete to be false
            let allComplete = true;
            for (const i in condition.visibilityConditions) {
                const visCondition = condition.visibilityConditions[i];
                // If the vis condition isn't completed, we want to set allComplete to false and break the loop
                if (!this.completedConditionIds.includes(visCondition.target)) {
                    allComplete = false;
                    break;
                }
            }
            // If all vis conditions are completed, we want to complete this condition
            shouldComplete = allComplete;
        }

        // Big ole switch case (just neater than having a ton of if else statements imo)
        switch (condition.conditionType) {
            case "CounterCreator":
                // Counter creator's need checks as not all will be caught by name check (extract from location for example)
                for (const i in condition.counter.conditions) {
                    const counterCondition = condition.counter.conditions[i];
                    // If it's of type location
                    if (counterCondition.conditionType === "Location") {
                        // Go through the list of available locations and if they're all removed, complete the condition
                        for (const j in counterCondition.target as string[]) {
                            const targetMapId = counterCondition.target[j].toLowerCase();
                            const isTargetMap = this.isMapName(this.getMapNameFromId(targetMapId));
                            if (isTargetMap && this.modConfig.RemoveQuestsOnMaps.includes(this.getMapNameFromId(targetMapId))) {
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
            case "FindItem": {
                
                let prevHasMapName = false;
                let prevConditionMap = "";
                if (prevCondition !== undefined && prevCondition.conditionType === "CounterCreator") {
                    const subCondition = prevCondition.counter.conditions[0];
                    if (subCondition !== undefined && subCondition.conditionType === "VisitPlace") {
                        if (this.shouldCompleteCondition(undefined, prevCondition)) {
                            // Get the map and base complete on that
                            const zoneId = subCondition.target as string;
                            prevConditionMap = this.getMapNameFromZoneId(zoneId);

                            if (this.modConfig.RemoveQuestsOnMaps.includes(prevConditionMap)) {
                                prevHasMapName = true;
                            }
                        }
                    }
                }
                // If it has mapname, associate the item with that location
                for (const i in condition.target as string[]) {
                    const targetId = condition.target[i];

                    if (hasMapName) {
                        this.questItemLocations[targetId] = conditionMap;
                    } else if (prevHasMapName) {
                        this.questItemLocations[targetId] = prevConditionMap;
                    }
                }

                shouldComplete = shouldComplete || prevHasMapName;

                
                break;
            }
            case "LeaveItemAtLocation": {
                // Check if the associated maps are on the list and cancel it if so
                // Go through the targets
                for (const i in condition.target as string[]) {
                    const targetId = condition.target[i];
                    // If our target item id is in our dict
                    if (targetId in this.questItemLocations) {
                        // Check if we want to skip based on the map it comes from
                        if (this.modConfig.RemoveQuestsOnMaps.includes(this.questItemLocations[targetId])) {
                            shouldComplete = true;
                            break;
                        }
                    }
                }

                // Get the map and base complete on that
                const zoneMap = this.getMapNameFromZoneId(condition.zoneId);
                if (this.modConfig.RemoveQuestsOnMaps.includes(zoneMap)) {
                    shouldComplete = true;
                    break;
                }
                break;
            }
            case "PlaceBeacon": {
                // Find out the map associated with the target zone id
                const zoneMap = this.getMapNameFromZoneId(condition.zoneId);
                // If we want to complete the conditon
                if (this.modConfig.RemoveQuestsOnMaps.includes(zoneMap)) {
                    shouldComplete = true;
                }
                break;
            }
            // We don't have to do anything to these, but I want to leave these here to represent all possible condition types
            case "Quest":
            case "Skill":
            case "WeaponAssembly":
            case "TraderLoyalty":
            default:
                break;
        }

        return shouldComplete;
    }

    /**
     * Completes a condition for a quest
     * @param condition condition to complete
     */
    completeCondition(condition: IQuestCondition): void {
        if (condition.conditionType == undefined) {
            return;
        }
        condition.value = 0;
    }

    /**
     * Extracts a map id from a string that contains a map name
     * @param text The condition's locale text
     * @returns A map id or undefined if no map is found
     */
    getMapNameFromConditionText(text: string): string | undefined {
        for (const mapId in this.mapIdToName) {
            const mapName = this.mapIdToName[mapId];
            if (text.toLowerCase().indexOf(mapName) !== -1) {
                return mapId;
            }
        }
        return undefined;
    }

    /**
     * Gets the display name of a map based on it's id
     * @param mapId The map id to get the display name of
     * @returns map display name
     */
    getMapNameFromId(mapId: string): string | undefined {
        for (const mapName in this.maps) {
            if (this.maps[mapName].base._Id === mapId) return mapName;
        }
        return undefined;
    }

    /**
     * Check if a string is a valid map name
     * @param mapName Map name to check
     * @returns true if it's a valid map name
     */
    isMapName(mapName: string): boolean {
        return mapName in this.maps;
    }

    /**
     * Get the map associated with a zone
     * @param zoneId to search for
     * @returns a valid map name
     */
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
