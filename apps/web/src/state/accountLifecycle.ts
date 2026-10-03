type AccountResetHandler = () => void;

let accountResetHandler: AccountResetHandler = () => undefined;
let accountGeneration = 0;

export function getAccountGeneration(): number {
  return accountGeneration;
}

export function registerAccountResetHandler(resetHandler: AccountResetHandler): void {
  accountResetHandler = resetHandler;
}

export function resetAccountState(): void {
  accountGeneration += 1;

  accountResetHandler();
}
