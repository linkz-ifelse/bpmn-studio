import {Aurelia} from 'aurelia-framework';
import {IFileInfo} from './contracts/processengine/index';
import environment from './environment';
import {TokenRepository} from './modules/token-repository/token.repository';

export function configure(aurelia: Aurelia): void {

  const tokenRepository: TokenRepository = new TokenRepository();
  aurelia.container.registerInstance('TokenRepository', tokenRepository);

  if (navigator.cookieEnabled === false) {
    const url: string = location.href;
    throw new Error(`In order to use the web version of BPMN Studio please enable cookies for this URL: ${url}.`);
  }

  if ((<any> window).nodeRequire) {
    const ipcRenderer: any = (<any> window).nodeRequire('electron').ipcRenderer;
    const newHost: string = ipcRenderer.sendSync('get_host');
    const fileInfo: IFileInfo = ipcRenderer.sendSync('get_opened_file');
    aurelia.container.registerInstance('FileContent', fileInfo);
    localStorage.setItem('processEngineRoute', `http://${newHost}`);
  }

  if (window.localStorage.getItem('processEngineRoute')) {
    const processEngineRoute: string = window.localStorage.getItem('processEngineRoute');
    environment.bpmnStudioClient.baseRoute = processEngineRoute;
    environment.processengine.routes.processes = `${processEngineRoute}/datastore/ProcessDef`;
    environment.processengine.routes.iam = `${processEngineRoute}/iam`;
    environment.processengine.routes.messageBus = `${processEngineRoute}/mb`;
    environment.processengine.routes.processInstances = `${processEngineRoute}/datastore/Process`;
    environment.processengine.routes.startProcess = `${processEngineRoute}/processengine/start`;
    environment.processengine.routes.userTasks =  `${processEngineRoute}/datastore/UserTask`;
    environment.processengine.routes.importBPMN = `${processEngineRoute}/processengine/create_bpmn_from_xml`;
  }

  aurelia.use
    .standardConfiguration()
    .feature('modules/dynamic-ui')
    .feature('modules/processengine')
    .feature('modules/notification')
    .feature('modules/authentication')
    .feature('modules/bpmn-studio_client', tokenRepository)
    .feature('resources')
    .plugin('aurelia-bootstrap')
    .plugin('aurelia-validation');

  if (environment.debug) {
    aurelia.use.developmentLogging();
  }

  if (environment.testing) {
    aurelia.use.plugin('aurelia-testing');
  }

  aurelia.start().then(() => aurelia.setRoot());
}
