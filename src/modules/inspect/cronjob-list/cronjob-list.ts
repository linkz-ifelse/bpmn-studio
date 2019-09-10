import {bindable, computedFrom, inject} from 'aurelia-framework';

import {ManagementApiClientService} from '@process-engine/management_api_client';
import {DataModels} from '@process-engine/management_api_contracts';

import {ForbiddenError, UnauthorizedError, isError} from '@essential-projects/errors_ts';
import {EventAggregator} from 'aurelia-event-aggregator';
import {ISolutionEntry} from '../../../contracts/index';
import environment from '../../../environment';
import {getBeautifiedDate} from '../../../services/date-service/date.service';

@inject('ManagementApiClientService', EventAggregator)
export class CronjobList {
  @bindable public activeSolutionEntry: ISolutionEntry;
  public initialLoadingFinished: boolean = false;
  public currentPage: number = 1;
  public pageSize: number = 10;
  public paginationSize: number = 10;
  public showError: boolean;

  private managementApiService: ManagementApiClientService;

  private cronjobs: Array<DataModels.Cronjobs.CronjobConfiguration> = [];
  private pollingTimeout: NodeJS.Timeout;
  private isAttached: boolean;
  private eventAggregator: EventAggregator;

  constructor(managementApiService: ManagementApiClientService, eventAggregator: EventAggregator) {
    this.managementApiService = managementApiService;
    this.eventAggregator = eventAggregator;
  }

  public async activeSolutionEntryChanged(newValue): Promise<void> {
    if (this.isAttached) {
      this.cronjobs = [];
      this.initialLoadingFinished = false;
      this.showError = false;
      this.eventAggregator.publish(environment.events.configPanel.solutionEntryChanged, newValue);

      await this.updateCronjobs();
    }
  }

  public async attached(): Promise<void> {
    this.isAttached = true;

    await this.updateCronjobs();
    this.startPolling();
  }

  public detached(): void {
    this.isAttached = false;
    this.stopPolling();
  }

  @computedFrom('cronjobs.length')
  public get totalItems(): number {
    return this.cronjobs.length;
  }

  @computedFrom('cronjobsToDisplay.length')
  public get showCronjobList(): boolean {
    return this.cronjobsToDisplay !== undefined && this.cronjobsToDisplay.length > 0;
  }

  public get cronjobsToDisplay(): Array<DataModels.Cronjobs.CronjobConfiguration> {
    const firstCronjobIndex: number = (this.currentPage - 1) * this.pageSize;
    const lastCronjobIndex: number = this.pageSize * this.currentPage;

    const cronjobsToDisplay: Array<DataModels.Cronjobs.CronjobConfiguration> = [...this.cronjobs]
      .sort(this.sortCronjobs)
      .slice(firstCronjobIndex, lastCronjobIndex);

    return cronjobsToDisplay;
  }

  public getBeautifiedDate(date: Date): string {
    const beautifiedDate: string = getBeautifiedDate(date);

    return beautifiedDate;
  }

  public async updateCronjobs(): Promise<void> {
    try {
      this.cronjobs = await this.managementApiService.getAllActiveCronjobs(this.activeSolutionEntry.identity);

      this.initialLoadingFinished = true;
    } catch (error) {
      this.initialLoadingFinished = true;

      const errorIsForbiddenError: boolean = isError(error, ForbiddenError);
      const errorIsUnauthorizedError: boolean = isError(error, UnauthorizedError);
      const errorIsAuthenticationRelated: boolean = errorIsForbiddenError || errorIsUnauthorizedError;

      if (!errorIsAuthenticationRelated) {
        this.cronjobs = [];
        this.showError = true;
      }
    }
  }

  private startPolling(): void {
    this.pollingTimeout = setTimeout(async () => {
      await this.updateCronjobs();

      if (this.isAttached) {
        this.startPolling();
      }
    }, environment.processengine.dashboardPollingIntervalInMs);
  }

  private stopPolling(): void {
    clearTimeout(this.pollingTimeout);
  }

  private sortCronjobs(
    firstCronjob: DataModels.Cronjobs.CronjobConfiguration,
    secondCronjob: DataModels.Cronjobs.CronjobConfiguration,
  ): number {
    return firstCronjob.nextExecution.getTime() - secondCronjob.nextExecution.getTime();
  }
}
