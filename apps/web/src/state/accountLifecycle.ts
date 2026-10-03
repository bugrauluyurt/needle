type AccountResetHandler = () => void;

let accountResetHandler: AccountResetHandler = () => undefined;

export function registerAccountResetHandler(resetHandler: AccountResetHandler): void {
  accountResetHandler = resetHandler;
}

export function resetAccountState(): void {
  accountResetHandler();
}
