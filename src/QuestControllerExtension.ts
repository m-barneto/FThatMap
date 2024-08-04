import { QuestController } from "@spt/controllers/QuestController";
import { DialogueHelper } from "@spt/helpers/DialogueHelper";
import { ItemHelper } from "@spt/helpers/ItemHelper";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { QuestConditionHelper } from "@spt/helpers/QuestConditionHelper";
import { QuestHelper } from "@spt/helpers/QuestHelper";
import { TraderHelper } from "@spt/helpers/TraderHelper";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { IQuest } from "@spt/models/eft/common/tables/IQuest";
import { IItemEventRouterResponse } from "@spt/models/eft/itemEvent/IItemEventRouterResponse";
import { IAcceptQuestRequestData } from "@spt/models/eft/quests/IAcceptQuestRequestData";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { EventOutputHolder } from "@spt/routers/EventOutputHolder";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { DatabaseService } from "@spt/services/DatabaseService";
import { LocaleService } from "@spt/services/LocaleService";
import { LocalisationService } from "@spt/services/LocalisationService";
import { MailSendService } from "@spt/services/MailSendService";
import { PlayerService } from "@spt/services/PlayerService";
import { SeasonalEventService } from "@spt/services/SeasonalEventService";
import { ICloner } from "@spt/utils/cloners/ICloner";
import { HttpResponseUtil } from "@spt/utils/HttpResponseUtil";
import { TimeUtil } from "@spt/utils/TimeUtil";
import { inject, injectable } from "tsyringe";
import { Mod } from "./mod";



@injectable()
export class QuestControllerExtension extends QuestController {
    constructor(
    @inject("PrimaryLogger") logger: ILogger, 
        @inject("TimeUtil") timeUtil: TimeUtil, 
        @inject("HttpResponseUtil") httpResponseUtil: HttpResponseUtil, 
        @inject("EventOutputHolder") eventOutputHolder: EventOutputHolder, 
        @inject("DatabaseService") databaseService: DatabaseService, 
        @inject("ItemHelper") itemHelper: ItemHelper, 
        @inject("DialogueHelper") dialogueHelper: DialogueHelper, 
        @inject("MailSendService") mailSendService: MailSendService, 
        @inject("ProfileHelper") profileHelper: ProfileHelper, 
        @inject("TraderHelper") traderHelper: TraderHelper, 
        @inject("QuestHelper") questHelper: QuestHelper, 
        @inject("QuestConditionHelper") questConditionHelper: QuestConditionHelper, 
        @inject("PlayerService") playerService: PlayerService, 
        @inject("LocaleService") localeService: LocaleService, 
        @inject("SeasonalEventService") seasonalEventService: SeasonalEventService, 
        @inject("LocalisationService") localisationService: LocalisationService, 
        @inject("ConfigServer") configServer: ConfigServer,
        @inject("PrimaryCloner") cloner: ICloner
    ) {
        super(
            logger,
            timeUtil,
            httpResponseUtil,
            eventOutputHolder,
            databaseService,
            itemHelper,
            dialogueHelper,
            mailSendService,
            profileHelper,
            traderHelper,
            questHelper,
            questConditionHelper,
            playerService,
            localeService,
            localisationService,
            configServer,
            cloner
        );
    }

    override acceptQuest(pmcData: IPmcData, acceptedQuest: IAcceptQuestRequestData, sessionID: string): IItemEventRouterResponse {
        const response = super.acceptQuest(pmcData, acceptedQuest, sessionID);
        this.logger.success("WTF MAN???");
        //updateProfileTaskConditionCounterValue
        const quest: IQuest = this.questHelper.getQuestFromDb(acceptedQuest.qid, pmcData);
        quest.conditions.AvailableForFinish.forEach(condition => {
            if (typeof condition.value === "number" && Mod.conditionsToSkip.includes(condition.id)) {
                this.updateProfileTaskConditionCounterValue(pmcData, condition.id, acceptedQuest.qid, condition.value);
                this.logger.success("FUCKING MODFIED A CONDITION WOOOOOOOOOO");
            }
        });

        return response;
    }
}