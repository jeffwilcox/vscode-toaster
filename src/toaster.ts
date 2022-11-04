import * as vscode from 'vscode';

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

const deleteInsteadOfToastingToasts = false;

type Toast = {
  date: Date;
  filename: string;
  contents: IToast;
};

type Toasted = {
  toast: IToast;
  toastedTime: string;
  toastedChoiceTime: string;
  toastedChoice: string;
  toastedNavigation?: string;
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

  url?: string;
  urlDisplayName?: string;
}

export class Toaster {
  private readonly _toastsPath: string;
  private _burntToast = new Map<string, Date>();

  constructor() {
    this._toastsPath = path.join(os.homedir(), '.toasts');
  }

  async fire() {
    const toasts = await this._getReadyToasts();
    if (toasts.length === 0) {
      return;
    }

    console.log(`Currently there are ${toasts.length} toasts ready to burn.`);

    const toast = toasts[0];
    try {
      await this.burnToast(toast);
    } catch (error) {
      console.error(error);
    }
  }

  private async burnToast(toast: Toast) {
    console.dir(toast);
    this._burntToast.set(toast.filename, toast.date);
    const { contents } = toast;
    await new Promise((resolve, reject) => {
      const okOption = contents?.ok || 'OK';
      const options = [okOption];
      let webOpenOption: string | null = null;
      if (contents?.url) {
        webOpenOption = contents?.urlDisplayName || 'Open ' + contents.url;
        options.push(webOpenOption);
      }
      const showToast = this.typeToCall(contents.type);
      const toastWritten = new Date();
      showToast(contents.message, ...options).then((value) => {
        console.log(value);
        let navigation;
        if (value === webOpenOption && contents.url) {
          navigation = contents.url;
        } else if (value === okOption && contents?.okUrl) {
          navigation = contents.okUrl;
        }
        if (navigation) {
          console.log(`Opening URL: ${navigation}`);
          vscode.env.openExternal(vscode.Uri.parse(navigation));
        }
        this._markToastToasted(toast.filename, contents, value || '', toastWritten, navigation).then(ok => {}).catch(error => {
          console.error(`Could not delete ${toast.filename}: ${error}`);
        });    
        return resolve(value);
      }, reject);
    });
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
        const contents = JSON.parse(raw);
        // Only if valid toast
        if (!contents.message) {
          throw new Error('Invalid toast: missing message');
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
              message: raw,
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
          toast,
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
