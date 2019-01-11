import {EventAggregator, Subscription} from 'aurelia-event-aggregator';
import {inject} from 'aurelia-framework';
import {Router} from 'aurelia-router';

import {isError, NotFoundError, UnauthorizedError} from '@essential-projects/errors_ts';
import {
  Correlation,
  IManagementApi,
  ManualTask,
  ManualTaskList,
  ProcessModelExecution,
  UserTask,
  UserTaskList,
} from '@process-engine/management_api_contracts';

import {
  AuthenticationStateEvent,
  ISolutionEntry,
  ISolutionService,
  NotificationType,
} from '../../../contracts/index';
import environment from '../../../environment';
import {NotificationService} from '../../notification/notification.service';

interface ITaskListRouteParameters {
  diagramName?: string;
  correlationId?: string;
}

interface IUserTaskWithProcessModel {
  userTask: UserTask;
  processModel: ProcessModelExecution.ProcessModel;
}

interface IManualTaskWithProcessModel {
  manualTask: ManualTask;
  processModel: ProcessModelExecution.ProcessModel;
}

@inject(EventAggregator, 'ManagementApiClientService', Router, 'NotificationService', 'SolutionService')
export class TaskList {

  public currentPage: number = 0;
  public pageSize: number = 10;
  public totalItems: number;

  public successfullyRequested: boolean = false;
  public activeSolutionEntry: ISolutionEntry;

  private _activeSolutionUri: string;
  private _eventAggregator: EventAggregator;
  private _managementApiService: IManagementApi;
  private _router: Router;
  private _notificationService: NotificationService;
  private _solutionService: ISolutionService;

  private _subscriptions: Array<Subscription>;
  private _userTasks: Array<IUserTaskWithProcessModel>;
  private _getTasksIntervalId: number;
  private _getTasks: () => Promise<Array<IUserTaskWithProcessModel>>;

  constructor(eventAggregator: EventAggregator,
              managementApiService: IManagementApi,
              router: Router,
              notificationService: NotificationService,
              solutionService: ISolutionService,
  ) {
    this._eventAggregator = eventAggregator;
    this._managementApiService = managementApiService;
    this._router = router;
    this._notificationService = notificationService;
    this._solutionService = solutionService;
  }

  public initializeTaskList(routeParameters: ITaskListRouteParameters): void {

    if (routeParameters.diagramName) {
      this._getTasks = (): Promise<Array<IUserTaskWithProcessModel>> => {
        return this._getTasksForProcessModel(routeParameters.diagramName);
      };
    } else if (routeParameters.correlationId) {
      this._getTasks = (): Promise<Array<IUserTaskWithProcessModel>> => {
        return this._getTasksForCorrelation(routeParameters.correlationId);
      };
    } else {
      this._getTasks = this._getAllTasks;
    }
  }

  public attached(): void {
    const getTasksIsUndefined: boolean = this._getTasks === undefined;

    this._activeSolutionUri = this._router.currentInstruction.queryParams.solutionUri;

    const activeSolutionUriIsNotSet: boolean = this._activeSolutionUri === undefined;

    if (activeSolutionUriIsNotSet) {
      this._activeSolutionUri = window.localStorage.getItem('InternalProcessEngineRoute');
    }

    this.activeSolutionEntry = this._solutionService.getSolutionEntryForUri(this._activeSolutionUri);

    if (getTasksIsUndefined) {
      this._getTasks = this._getAllTasks;
      this.updateTasks();
    }

    this._getTasksIntervalId = window.setInterval(() => {
      this.updateTasks();
    }, environment.processengine.dashboardPollingIntervalInMs);

    this._subscriptions = [
      this._eventAggregator.subscribe(AuthenticationStateEvent.LOGIN, () => {
        this.updateTasks();
      }),
      this._eventAggregator.subscribe(AuthenticationStateEvent.LOGOUT, () => {
        this.updateTasks();
      }),
    ];

    this.updateTasks();
  }

  public detached(): void {
    clearInterval(this._getTasksIntervalId);

    for (const subscription of this._subscriptions) {
      subscription.dispose();
    }
  }

  public goBack(): void {
    this._router.navigateBack();
  }

  public continueTask(taskWithProcessModel: IUserTaskWithProcessModel & IManualTaskWithProcessModel): void {
    const correlationId: string = taskWithProcessModel.userTask
      ? taskWithProcessModel.userTask.correlationId
      : taskWithProcessModel.manualTask.correlationId;

    const tasksProcessModelId: string = taskWithProcessModel.userTask
      ? taskWithProcessModel.userTask.processModelId
      : taskWithProcessModel.manualTask.processModelId;

    const taskIsFromCallActivity: boolean = taskWithProcessModel.processModel.id !== tasksProcessModelId;

    const processModelId: string = taskIsFromCallActivity
      ? tasksProcessModelId
      : taskWithProcessModel.processModel.id;

    const taskId: string = taskWithProcessModel.userTask
      ? taskWithProcessModel.userTask.id
      : taskWithProcessModel.manualTask.id;

    this._router.navigateToRoute('task-dynamic-ui', {
      diagramName: processModelId,
      solutionUri: this.activeSolutionEntry.uri,
      correlationId: correlationId,
      taskId: taskId,
    });
  }

  public get shownTasks(): Array<IUserTaskWithProcessModel> {
    return this.tasks.slice((this.currentPage - 1) * this.pageSize, this.pageSize * this.currentPage);
  }

  public get tasks(): Array<IUserTaskWithProcessModel> {
    const noTasksExisitng: boolean = this._userTasks === undefined;
    if (noTasksExisitng) {
      return [];
    }

    return this._userTasks;
  }

  private async _getAllTasks(): Promise<Array<IUserTaskWithProcessModel & IManualTaskWithProcessModel>> {

    const allProcessModels: ProcessModelExecution.ProcessModelList = await this._managementApiService
                                                                               .getProcessModels(this.activeSolutionEntry.identity);

    // TODO (ph): This will create 1 + n http reqeusts, where n is the number of process models in the processengine.
    const promisesForAllUserTasks: Array<Promise<Array<IUserTaskWithProcessModel>>> = allProcessModels.processModels
      .map(async(processModel: ProcessModelExecution.ProcessModel): Promise<Array<IUserTaskWithProcessModel>> => {
        try {
          const userTaskList: UserTaskList = await this._managementApiService
                                                       .getUserTasksForProcessModel(this.activeSolutionEntry.identity, processModel.id);

          const userTasksAndProcessModels: Array<IUserTaskWithProcessModel> = this._addProcessModelToUserTasks(userTaskList, processModel);

          return userTasksAndProcessModels;

        } catch (error) {
          if (isError(error, NotFoundError)) {
            // the management api returns a 404 if there is no instance of a process model running.
            return Promise.resolve([]);
          }

          throw error;
        }
      });

    const promisesForAllManualTasks: Array<Promise<Array<IManualTaskWithProcessModel>>> = allProcessModels.processModels
      .map(async(processModel: ProcessModelExecution.ProcessModel): Promise<Array<IManualTaskWithProcessModel>> => {
        try {
          const manualTaskList: ManualTaskList = await this._managementApiService
                                                           .getManualTasksForProcessModel(this.activeSolutionEntry.identity, processModel.id);

          const manualTasksAndProcessModels: Array<IManualTaskWithProcessModel> = this._addProcessModelToManualTasks(manualTaskList, processModel);

          return manualTasksAndProcessModels;

        } catch (error) {
          if (isError(error, NotFoundError)) {
            // the management api returns a 404 if there is no instance of a process model running.
            return [];
          }
          throw error;
        }
     });

    type UserAndManualTasksWithProcessModels = Array<IUserTaskWithProcessModel & IManualTaskWithProcessModel>;
    type PromisesForUserAndManualTasks = Promise<UserAndManualTasksWithProcessModels>;

    // Concatentate the array of promises with the UserTasks and the array of promises wuth the ManualTasks to one array
    const promisesForAllTasksForAllProcessModels: Array<PromisesForUserAndManualTasks> = []
      .concat(promisesForAllUserTasks, promisesForAllManualTasks);

    // Await all promises
    const allTasksForAllProcessModels: Array<UserAndManualTasksWithProcessModels> =
      await Promise.all(promisesForAllTasksForAllProcessModels);

    // Move all tasks from arrays in arrays to a single array
    const allTasks: UserAndManualTasksWithProcessModels = [].concat(...allTasksForAllProcessModels);

    return allTasks;
  }

  private async _getTasksForProcessModel(processModelId: string): Promise<Array<IUserTaskWithProcessModel & IManualTaskWithProcessModel>> {

    const processModel: ProcessModelExecution.ProcessModel = await
      this
      ._managementApiService
      .getProcessModelById(this.activeSolutionEntry.identity, processModelId);

    let userTaskList: UserTaskList;
    let manualTaskList: ManualTaskList;
    try {
      userTaskList = await this._managementApiService.getUserTasksForProcessModel(this.activeSolutionEntry.identity, processModelId);
      manualTaskList = await this._managementApiService.getManualTasksForProcessModel(this.activeSolutionEntry.identity, processModelId);

    } catch (error) {
      if (isError(error, NotFoundError)) {
        // the management api returns a 404 if there is no instance of a process model running.
        return Promise.resolve([]);
      }
      throw error;
    }

    const userTasksAndProcessModels: Array<IUserTaskWithProcessModel> = this._addProcessModelToUserTasks(userTaskList, processModel);
    const manualTasksAndProcessModels: Array<IManualTaskWithProcessModel> = this._addProcessModelToManualTasks(manualTaskList, processModel);

    return [].concat(userTasksAndProcessModels, manualTasksAndProcessModels);
  }

  private async _getTasksForCorrelation(correlationId: string): Promise<Array<IUserTaskWithProcessModel & IManualTaskWithProcessModel>> {

    const userTaskList: UserTaskList = await this._managementApiService.getUserTasksForCorrelation(this.activeSolutionEntry.identity, correlationId);
    const manualTaskList: ManualTaskList = await this._managementApiService
                                                     .getManualTasksForCorrelation(this.activeSolutionEntry.identity, correlationId);

    const runningCorrelations: Array<Correlation> = await this._managementApiService.getActiveCorrelations(this.activeSolutionEntry.identity);

    const correlation: Correlation = runningCorrelations.find((otherCorrelation: Correlation) => {
      return otherCorrelation.id === correlationId;
    });

    const correlationWasNotFound: boolean = correlation === undefined || correlation === null;
    if (correlationWasNotFound) {
      throw new NotFoundError(`No correlation found with id ${correlationId}.`);
    }

    // TODO: This needs to be refactored so that the correct ProcessModel will be used depending on the user task
    const processModelOfCorrelation: ProcessModelExecution.ProcessModel = await
      this
      ._managementApiService
      .getProcessModelById(this.activeSolutionEntry.identity, correlation.processModels[0].processModelId);

    const userTasksAndProcessModels: Array<IUserTaskWithProcessModel> = this._addProcessModelToUserTasks(userTaskList, processModelOfCorrelation);
    const manualTasksAndProcessModels: Array<IManualTaskWithProcessModel> = this._addProcessModelToManualTasks(
                                                                            manualTaskList, processModelOfCorrelation);

    return [].concat(userTasksAndProcessModels, manualTasksAndProcessModels);
  }

  private _addProcessModelToUserTasks(
    userTaskList: UserTaskList,
    processModel: ProcessModelExecution.ProcessModel,
  ): Array<IUserTaskWithProcessModel> {

    const userTasksAndProcessModels: Array<IUserTaskWithProcessModel> = userTaskList.userTasks
      .map((userTask: UserTask): IUserTaskWithProcessModel => ({
          processModel: processModel,
          userTask: userTask,
      }));

    return userTasksAndProcessModels;
  }

  private _addProcessModelToManualTasks(
    manualTaskList: ManualTaskList,
    processModel: ProcessModelExecution.ProcessModel,
  ): Array<IManualTaskWithProcessModel> {

    const manualTasksAndProcessModels: Array<IManualTaskWithProcessModel> = manualTaskList.manualTasks
      .map((manualTask: ManualTask): IManualTaskWithProcessModel => ({
          processModel: processModel,
          manualTask: manualTask,
      }));

    return manualTasksAndProcessModels;
  }

  public async updateTasks(): Promise<void> {
    try {
      this._userTasks = await this._getTasks();
      this.successfullyRequested = true;

    } catch (error) {

      if (isError(error, UnauthorizedError)) {

        this._notificationService.showNotification(NotificationType.ERROR, 'You don\'t have permission to view the task list.');
        this._router.navigateToRoute('start-page');

      } else {

        this._notificationService.showNotification(NotificationType.ERROR, `Error receiving task list: ${error.message}`);

      }
    }

    this.totalItems = this.tasks.length;
  }
}
