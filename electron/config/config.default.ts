import path from 'path';
import { getBaseDir } from 'ee-core/ps';
import { type AppConfig } from 'ee-core/config';

const config: () => AppConfig = () => {
  return {
    openDevTools: false,
    singleLock: true,
    windowsOption: {
      title: 'Koma Studio',
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 768,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#0f0f0f',
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(getBaseDir(), 'public', 'electron', 'preload', 'bridge.js'),
      },
    },
    logger: {
      level: 'INFO',
      outputJSON: false,
      appLogName: 'koma.log',
      coreLogName: 'ee-core.log',
      errorLogName: 'koma-error.log',
    },
    socketServer: {
      enable: false,
      port: 7070,
      channel: 'socket-channel',
    },
    httpServer: {
      enable: false,
      port: 7071,
    },
    remote: {
      enable: false,
      url: '',
    },
    mainServer: {
      protocol: 'file://',
      indexPath: '/public/dist/index.html',
      options: {},
      takeover: '',
      loadingPage: '',
      channelSeparator: '/',
    },
    exception: {
      mainExit: false,
      childExit: false,
      rendererExit: true,
    },
    jobs: {
      messageLog: false,
    },
    cross: {},
  };
};

export default config;
