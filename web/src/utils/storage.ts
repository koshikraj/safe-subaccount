export const storeWalletInfo = (wallet: Object) => {

    localStorage.setItem('wallet', JSON.stringify(wallet));
}


export const loadWalletInfo = (): any => {

    const accountInfo = localStorage.getItem('wallet');
    return accountInfo ? JSON.parse(accountInfo) : {};
}