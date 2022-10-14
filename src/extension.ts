import * as vscode from 'vscode';
import { Toaster } from './toaster';

const checkIntervalMs = 1000;
let timer: NodeJS.Timeout;

let toaster: Toaster | null = null;

let isFiring = false;

export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "toaster" is now active!');

	toaster = new Toaster();

	timer = setInterval(() => {
		if (toaster && !isFiring) {
			isFiring = true;
			toaster.fire().catch(err => {
				console.error(err);
			}).then(ok => {}).finally(() => {
				isFiring = false;
			});
		}
	}, checkIntervalMs);

	// // The command has been defined in the package.json file
	// // Now provide the implementation of the command with registerCommand
	// // The commandId parameter must match the command field in package.json
	// let disposable = vscode.commands.registerCommand('toaster.helloWorld', () => {
	// 	// The code you place here will be executed every time your command is executed
	// 	// Display a message box to the user
	// 	vscode.window.showInformationMessage('Hello World from toaster!');
	// });

	// context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {
	toaster = null;
	if (timer) {
		clearInterval(timer);
	}
}
