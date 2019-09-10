import path from 'path';

import {AppConstructorOptions} from 'spectron';
import {TestClient} from './TestClient';

const isWindows = process.platform === 'win32';
const applicationArgs = getApplicationArgs(process.env.SPECTRON_APP_PATH);

function getApplicationArgs(givenPath: string | null): AppConstructorOptions {
  const commonArgs = {
    requireName: 'nodeRequire',
    env: {
      SPECTRON_TESTS: true,
    },
    webdriverOptions: {
      deprecationWarnings: false,
    },
  };

  if (givenPath != null) {
    console.log(`Using path: ${givenPath}`);
    return {...commonArgs, path: givenPath};
  }

  const electronExecutable = isWindows ? 'electron.cmd' : 'electron';
  const electronPath = path.join(__dirname, '..', '..', '..', '..', 'node_modules', '.bin', electronExecutable);
  const electronBundlePath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'dist',
    'electron_app',
    'electron_app',
    'electron.js',
  );

  return {...commonArgs, path: electronPath, args: [electronBundlePath]};
}

async function createAndOpenDiagram(): Promise<void> {
  if (!creatingFirstDiagram) {
    await testClient.openStartPage();
  }

  await testClient.createAndOpenNewDiagram();
}

let testClient: TestClient;

let creatingFirstDiagram: boolean = true;

describe('Application launch', function foo() {
  this.slow(10000);
  this.timeout(15000);

  beforeEach(async () => {
    testClient = new TestClient(applicationArgs);

    creatingFirstDiagram = true;
    await testClient.startSpectronApp();
    await testClient.awaitReadyness();
  });

  afterEach(async () => {
    if (await testClient.isSpectronAppRunning()) {
      await testClient.stopSpectronApp();
      return testClient.clearDatabase();
    }
    return null;
  });

  this.afterAll(async () => {
    await testClient.clearSavedDiagrams();
  });

  it('should start the application', async () => {
    await testClient.elementHasText('h3', 'Welcome');

    await testClient.assertWindowTitleIs('Start Page | BPMN Studio');
  });

  it('should create and open a new diagram by clicking on new diagram link', async () => {
    await createAndOpenDiagram();

    await testClient.assertNavbarTitleIs('Untitled-1');
    await testClient.assertWindowTitleIs('Design | BPMN Studio');
  });

  it('should render a diagram correctly', async () => {
    await createAndOpenDiagram();

    await testClient.ensureVisible('[data-element-id="Collaboration_1cidyxu"]');
  });

  it('should select StartEvent after opening a diagram', async () => {
    await createAndOpenDiagram();
    await testClient.showPropertyPanel();

    await testClient.assertSelectedBpmnElementHasName('Start Event');
  });

  it('should select element on click', async () => {
    await createAndOpenDiagram();
    await testClient.showPropertyPanel();

    const elementName = 'End Event';

    await testClient.rejectSelectedBpmnElementHasName(elementName);
    await testClient.clickOnBpmnElementWithName(elementName);
    await testClient.assertSelectedBpmnElementHasName(elementName);
  });

  it('should create and open a second diagram', async () => {
    await createAndOpenDiagram();

    await testClient.assertNavbarTitleIs('Untitled-1');
    await testClient.assertWindowTitleIs('Design | BPMN Studio');

    creatingFirstDiagram = false;
    await createAndOpenDiagram();

    await testClient.assertNavbarTitleIs('Untitled-2');
  });

  it('should open detail view', async () => {
    await createAndOpenDiagram();
    await testClient.openStartPage();

    await testClient.openDesignViewForDiagram(
      'Untitled-1',
      'about:open-diagrams/Untitled-1.bpmn',
      'about:open-diagrams',
    );

    await testClient.assertCanvasModelIsVisible();
  });

  it('should open XML view', async () => {
    await createAndOpenDiagram();

    await testClient.openXmlViewForDiagram('Untitled-1', 'about:open-diagrams/Untitled-1.bpmn', 'about:open-diagrams');

    await testClient.assertXmlViewHasContent();
  });

  it('should open diff view', async () => {
    await createAndOpenDiagram();

    await testClient.openDiffViewForDiagram('Untitled-1', 'about:open-diagrams/Untitled-1.bpmn', 'about:open-diagrams');

    await testClient.assertDiffViewHasRenderedAllContainer();
  });

  it('should open the xml view from the status bar', async () => {
    await createAndOpenDiagram();
    await testClient.openXmlViewFromStatusbar();
    await testClient.assertXmlContainsText('id="Untitled-1"');
  });

  it('should open design view from the status bar', async () => {
    // Arrange
    await createAndOpenDiagram();
    await testClient.openXmlViewFromStatusbar();

    // Act and Assert
    await testClient.openDesignViewFromStatusbar();
  });

  it('should create and open a new diagam by clicking on new diagram link', async () => {
    await createAndOpenDiagram();

    await testClient.assertNavbarTitleIs('Untitled-1');
    await testClient.assertWindowTitleIs('Design | BPMN Studio');
  });

  it('should open a solution', async () => {
    await testClient.startPageLoaded();

    await testClient.openDirectoryAsSolution('fixtures');
  });

  it('should open a diagram from solution', async () => {
    await testClient.startPageLoaded();

    const diagramName = 'call_activity_subprocess_error';
    await testClient.openDirectoryAsSolution('fixtures', diagramName);
    await testClient.assertNavbarTitleIs(diagramName);
  });

  it('should open the internal ProcessEngine as solution', async () => {
    await testClient.startPageLoaded();

    await testClient.assertInternalProcessEngineIsOpenedAsSolution();
  });

  it('should show the SolutionExplorer', async () => {
    // Arrange
    await testClient.startPageLoaded();
    await testClient.hideSolutionExplorer();

    // Act and Assert
    await testClient.showSolutionExplorer();
  });

  it('should hide the SolutionExplorer', async () => {
    await testClient.startPageLoaded();

    await testClient.hideSolutionExplorer();
  });

  it('should open the Think view', async () => {
    await createAndOpenDiagram();

    await testClient.openThinkView('Untitled-1', 'about:open-diagrams/Untitled-1.bpmn', 'about:open-diagrams');
    await testClient.assertWindowTitleIs('Think | BPMN Studio');
  });

  it('should open the Think view from navbar', async () => {
    await createAndOpenDiagram();

    await testClient.openThinkViewFromNavbar();
    await testClient.assertWindowTitleIs('Think | BPMN Studio');
  });

  it('should save a diagram', async () => {
    // Arrange
    await createAndOpenDiagram();
    await testClient.assertDiagramIsUnsaved();

    // Act and Assert
    await testClient.saveDiagramAs('test1.bpmn');
    await testClient.assertDiagramIsSaved();
  });

  it('should deploy a diagram', async () => {
    // Arrange
    const diagramName = 'receive_task_wait_test';
    await testClient.startPageLoaded();
    await testClient.openDirectoryAsSolution('fixtures', diagramName);
    await testClient.assertDiagramIsOnFileSystem();

    if (isWindows) {
      await testClient.pause(800);
    }

    // Act
    await testClient.deployDiagram();
    // Assert
    await testClient.assertNavbarTitleIs(diagramName);
    await testClient.assertDiagramIsOnProcessEngine();
  });

  it('should start a process', async () => {
    const diagramName = 'receive_task_wait_test';
    await testClient.startPageLoaded();
    await testClient.openDirectoryAsSolution('fixtures', diagramName);
    await testClient.assertDiagramIsOnFileSystem();
    await testClient.deployDiagram();
    await testClient.assertNavbarTitleIs(diagramName);
    await testClient.assertDiagramIsOnProcessEngine();

    await testClient.startProcess();
  });

  it('should stop a process on LiveExecutionTracker', async () => {
    const diagramName = 'receive_task_wait_test';
    await testClient.startPageLoaded();
    await testClient.openDirectoryAsSolution('fixtures', diagramName);
    await testClient.assertDiagramIsOnFileSystem();
    await testClient.deployDiagram();
    await testClient.assertNavbarTitleIs(diagramName);
    await testClient.assertDiagramIsOnProcessEngine();
    await testClient.startProcess();

    await testClient.stopProcess();
  });
});