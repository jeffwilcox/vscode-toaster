import * as vscode from 'vscode';

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

const deleteInsteadOfToastingToasts = false;
const supportDeviceFlowProjections = true;

type Toast = {
  date: Date;
  filename: string;
  contents: IToast;
};

// @eslint-ignore
type DeviceFlowFormat = {
  UserCode: string;
  DeviceCode: string;
  VerificationUrl: string;
  ExpiresOn: string;
  Interval: number;
  Message: string;
  ClientId: string;
  Scopes: string[];
};

type Toasted = {
  toast: IToast | string;
  toastedTime: string;
  toastedChoiceTime: string;
  toastedChoice: string;
  toastedNavigation?: string;
  clipboardOutcome?: boolean;
};

enum ToastType {
  information = 'information',
  warning = 'warning',
  error = 'error',
}

interface IToast {
  type: ToastType;
  message: string;

  ok?: string;
  okUrl?: string;
  okClipboard?: string;

  url?: string;
  urlDisplayName?: string;
  urlClipboard?: string;

  burnAfterReading?: boolean;
}

export class Toaster {
  private readonly _toastsPath: string;
  private _burntToast = new Map<string, Date>();

  constructor() {
    this._toastsPath = path.join(os.homedir(), '.toasts');
  }

  async fire() {
    const toasts = await this._getReadyToasts();
    if (toasts.length) {
      console.log(`Currently there are ${toasts.length} toasts ready to action.`);
      for (const toast of toasts) {
        this.burnToast(toast).then(ok => {
          console.log(`OK, toast ${toast.filename} from ${toast.date} completed.`);
        }).catch(err => {
          console.log(`Error while processing toast ${toast.filename} from ${toast.date}. Error: ${err}`);
        });
      }
    }
  }

  private async burnToast(toast: Toast) {
    console.dir(toast);
    this._burntToast.set(toast.filename, toast.date);
    const { contents } = toast;
    const okOption = contents?.ok || 'OK';
    const options = [okOption];
    let webOpenOption: string | null = null;
    if (contents?.url) {
      webOpenOption = contents?.urlDisplayName || contents.url;
      options.push(webOpenOption);
    }
    const showToast = this.typeToCall(contents.type);
    const toastWritten = new Date();
    const errors = [];
    let value: string | undefined;
    let navigation = '';
    let navOutcome: boolean;
    let copyToClipboard = '';
    try {
      value = await showToast(contents.message, ...options);
      console.log(`The user chose: ${value}`);
      if (value === webOpenOption && contents.url) {
        navigation = contents.url;
      } else if (value === okOption && contents?.okUrl) {
        navigation = contents.okUrl;
      }
      if (value === webOpenOption && contents.urlClipboard) {
        copyToClipboard = contents.urlClipboard;
      } else if (value === okOption && contents?.okClipboard) {
        copyToClipboard = contents.okClipboard;
      }
      // POC clipboard support
      if (copyToClipboard) {
        console.log(`Copying to the clipboard: ${copyToClipboard}`);
        try {
          await vscode.env.clipboard.writeText(copyToClipboard as string);
          console.log('The clipboard was written to.');
        } catch (error) {
          errors.push(error);
        }
      }
      // Navigation
      if (navigation) {
        console.log(`Opening URL: ${navigation}`);
        try {
          navOutcome = await vscode.env.openExternal(vscode.Uri.parse(navigation));
          console.log(`Navigation outcome: ${navOutcome} going to ${navigation}`);
        } catch (error) {
          errors.push(error);
        }
      }
    } catch (error) {
      errors.push(error);
    } finally {
      if (errors?.length) {
        console.log('Errors:');
        errors.map(err => console.warn(err));
        console.log();
      }
      try {
        // The toast has been toasted
        await this._markToastToasted(toast.filename, contents, value || '', toastWritten, navigation);
      } catch (innerToastError) {
        console.log(`Inner error while toasting: ${innerToastError}`);
        console.warn(innerToastError);
      }
    }
  }

  private typeToCall(type: ToastType) {
    switch (type) {
      case ToastType.information:
        return vscode.window.showInformationMessage;
      case ToastType.warning:
        return vscode.window.showWarningMessage;
      case ToastType.error:
        return vscode.window.showErrorMessage;
    }
  }

  private async _getReadyToasts() {
    const toasts = (await this._getUntoastedFilenames()) as Toast[];
    const readyToasts: Toast[] = [];

    await Promise.allSettled(toasts.map(async toast => {
      let raw: string = '';
      try {
        const fp = path.join(this._toastsPath, toast.filename);
        raw = await fs.readFile(fp, 'utf8');
        let contents = JSON.parse(raw);
        if (supportDeviceFlowProjections && isDeviceFlowFormat(contents)) {
          contents = projectDeviceFlowToToast(contents);
        }
        if (!contents.message) {
          // Fallback to a JSON display as the value instead
          contents.message = JSON.stringify(contents, null, 2);
        }
        if (!contents.type) {
          contents.type = ToastType.information;
        }
        if (contents.type !== ToastType.information &&
          contents.type !== ToastType.warning &&
          contents.type !== ToastType.error) {
          throw new Error(`Invalid toast type: ${contents.type}`);
        }
        toast.contents = contents;
        readyToasts.push(toast);
      } catch (error: any) {
        if (raw && raw.length > 0 && error.message?.includes('JSON')) {
          readyToasts.push({
            date: toast.date,
            filename: toast.filename,
            contents: {
              type: ToastType.information,
              message: raw.trim(),
            },
          });
        } else {
          console.error(error);
        }
      }
    }));
    readyToasts.sort((a, b) => {
      return a.date.getTime() - b.date.getTime();
    });
    return readyToasts;
  }

  private async _markToastToasted(filename: string, toast: IToast, choice: string, toastWritten: Date, navigation: string | undefined) {
    try {
      const fp = path.join(this._toastsPath, filename);
      console.log(`Toasted toast file ${fp}`);
      if (deleteInsteadOfToastingToasts) {
        console.log(`Unlinking file ${fp}`);
        await fs.unlink(fp);
      } else {
        console.log(`Toasting file ${fp}`);
        const extension = path.extname(filename);
        const basename = path.basename(filename, extension);
        const toastedPath = path.join(this._toastsPath, `${basename}.toasted`);
        const toasted: Toasted = {
          toast: toast.burnAfterReading ? '[redacted]' : toast,
          toastedChoiceTime: (new Date()).toISOString(),
          toastedTime: toastWritten.toISOString(),
          toastedChoice: choice,
          toastedNavigation: navigation,
        };
        const toastedFileContent = JSON.stringify(toasted, null, 2);
        await fs.writeFile(toastedPath, toastedFileContent, 'utf8');
        console.log(`Wrote toasted file ${toastedPath}`);
        await fs.unlink(fp);
        console.log(`Unlinking file ${fp}`);
      }
    } catch (error: any) {
      console.error(error);
    }
  }

  private async _getUntoastedFilenames() {
    const filenames = await this._getToastFilenames();
    let toasts = await Promise.all(filenames.map(async filename => {
      const date = await this._getToastDate(filename);
      return {
        filename,
        date,
      };
    }));
    toasts = toasts.filter(t => {
      if (!this.withinMinute(t.date)) {
        return false;
      }
      let burnt = this._burntToast.get(t.filename);
      if (burnt && burnt <= t.date) {
        return false;
      }
      return true;
    });
    return toasts;
  }

  private async _getToastFilenames(): Promise<string[]> {
    try {
      const toasts = await fs.readdir(this._toastsPath);
      return toasts.filter(fp => !fp.includes('.swp') && !fp.endsWith('.toasted'));
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(error);
      }
    }

    return [];
  }

  private async _getToastDate(filename: string) {
    try {
      const fp = path.join(this._toastsPath, filename);
      const info = await fs.stat(fp);
      return info.mtime || info.ctime;
    } catch (error: any) {
      console.error(error);
    }
    return new Date(0);
  }

  private withinMinute(date: Date) {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    return diff < 60 * 1000;
  }
}

function isDeviceFlowFormat(contents: any) {
  return (contents?.UserCode && contents?.VerificationUrl && contents?.Message);
}

function projectDeviceFlowToToast(deviceFlow: DeviceFlowFormat) {
  console.log('Projecting device flow file:');
  console.dir(deviceFlow);
  console.log();
  console.log('To toast:');

  const toast: IToast = {
    type: ToastType.information,
    message: deviceFlow.Message + `\n\nThe code ${deviceFlow.UserCode} has been copied to your clipboard.`,
    okClipboard: deviceFlow.UserCode,
    okUrl: deviceFlow.VerificationUrl,
    ok: 'Verify',
    burnAfterReading: true,
  };
  console.dir(toast);
  return toast;
}
