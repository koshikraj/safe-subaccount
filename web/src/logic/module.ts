import { Contract, ZeroAddress, parseEther, parseUnits, getBytes, JsonRpcProvider, toBeHex, Interface } from "ethers";
import { ethers, utils } from 'ethersv5';
import { BaseTransaction } from '@safe-global/safe-apps-sdk';
import { getSafeInfo, isConnectedToSafe, submitTxs } from "./safeapp";
import { isModuleEnabled, buildEnableModule, isGuardEnabled, buildEnableGuard, buildUpdateFallbackHandler } from "./safe";
import { getJsonRpcProvider, getProvider } from "./web3";
import Safe7579 from "./Safe7579.json"
import SpendLimitSession from "./SpendLimitSession.json"
import EntryPoint from "./EntryPoint.json"
import { getTokenDecimals, publicClient } from "./utils";
import {  buildUnsignedUserOpTransaction } from "@/utils/userOp";
import { createClient, http, Chain, Hex, pad, custom, createWalletClient } from "viem";
import { sepolia } from 'viem/chains'
import { bundlerActions, ENTRYPOINT_ADDRESS_V07, getPackedUserOperation, UserOperation, getAccountNonce } from 'permissionless'
import {  createPimlicoPaymasterClient } from "permissionless/clients/pimlico";
import { pimlicoBundlerActions, pimlicoPaymasterActions } from 'permissionless/actions/pimlico'
import { privateKeyToAccount } from "viem/accounts";
import { EIP1193Provider } from "@privy-io/react-auth";

const safe7579Module = "0xbaCA6f74a5549368568f387FD989C279f940f1A5"
const spendLimitModule = "0x6517188232b2845067BA4A5AD9C5f36E51cA2914"



export const getSessionData = async (chainId: string, sessionKey: string, token: string): Promise<any> => {


    const bProvider = await getJsonRpcProvider(chainId)

    const spendLimit = new Contract(
        spendLimitModule,
        SpendLimitSession.abi,
        bProvider
    )


    const sesionData = await spendLimit.sessionKeys(sessionKey, token);

    return sesionData;

}



/**
 * Generates a deterministic key pair from an arbitrary length string
 *
 * @param {string} string - The string to generate a key pair from
 * @returns {Object} - An object containing the address and privateKey
 */
export function generateKeysFromString(string: string) {
    const privateKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(string)) // v5
    const wallet = new ethers.Wallet(privateKey)
    return {
        address: wallet.address,
        privateKey: privateKey,
    }
}




/**
 * Hashes a plain address, adds an Ethereum message prefix, hashes it again and then signs it
 */
export async function signAddress(string: string, privateKey: string) {
    const stringHash = ethers.utils.solidityKeccak256(['address'], [string]) // v5
    const stringHashbinary = ethers.utils.arrayify(stringHash) // v5
    const signer = new ethers.Wallet(privateKey)
    const signature = await signer.signMessage(stringHashbinary) // this calls ethers.hashMessage and prefixes the hash
    return signature
}


export const sendTransaction = async (chainId: string, recipient: string, amount: bigint, walletProvider: any, walletAddress: string): Promise<any> => {

  
    const bProvider = await getJsonRpcProvider(chainId)


    const { account } = await getSessionData(chainId, walletAddress, ZeroAddress)

    console.log(account)


    const abi = [
        'function execute(address sessionKey, address to, uint256 value, bytes calldata data) external',
      ]

    const execCallData = new Interface(abi).encodeFunctionData('execute', [walletAddress, recipient, amount, '0x' as Hex])


    console.log(execCallData)
  

    const call = { target: spendLimitModule as Hex, value: 0, callData: execCallData as Hex }


    const key = BigInt(pad(spendLimitModule as Hex, {
        dir: "right",
        size: 24,
      }) || 0
    )
    
    const nonce = await getAccountNonce(publicClient(parseInt(chainId)), {
        sender: account as Hex,
        entryPoint: ENTRYPOINT_ADDRESS_V07,
        key: key
    })


    let sessionOp = buildUnsignedUserOpTransaction(
        account,
        call,
        nonce,
      )


    const entryPoint = new Contract(
        ENTRYPOINT_ADDRESS_V07,
        EntryPoint.abi,
        bProvider
    )


    const chain = "sepolia" 


    const pimlicoEndpoint = `https://api.pimlico.io/v2/${chain}/rpc?apikey=${import.meta.env.VITE_PIMLICO_API_KEY}`


    const bundlerClient = createClient({
        transport: http(pimlicoEndpoint),
        chain: sepolia as Chain,
    })
        .extend(bundlerActions(ENTRYPOINT_ADDRESS_V07))
        .extend(pimlicoBundlerActions(ENTRYPOINT_ADDRESS_V07))

     const paymasterClient = createPimlicoPaymasterClient({
        transport: http(pimlicoEndpoint),
        entryPoint: ENTRYPOINT_ADDRESS_V07,
    })
    
     


    const gasPrice = await bundlerClient.getUserOperationGasPrice()


    sessionOp.maxFeePerGas = gasPrice.fast.maxFeePerGas;
    sessionOp.maxPriorityFeePerGas = gasPrice.fast.maxPriorityFeePerGas;



    const sponsorUserOperationResult = await paymasterClient.sponsorUserOperation({
        userOperation: sessionOp
    })



   
    const sponsoredUserOperation: UserOperation<"v0.7"> = {
        ...sessionOp,
        ...sponsorUserOperationResult,
    }

    let typedDataHash = getBytes(await entryPoint.getUserOpHash(getPackedUserOperation(sponsoredUserOperation)))

 
    sponsoredUserOperation.signature = await walletProvider.signMessage({account: walletAddress , message:  { raw: typedDataHash}}) as `0x${string}`


    const userOperationHash = await bundlerClient.sendUserOperation({
        userOperation: sponsoredUserOperation,

    })

    return userOperationHash;

}


export const waitForExecution = async (userOperationHash: string) => {


    const chain = "sepolia" 


    const pimlicoEndpoint = `https://api.pimlico.io/v2/${chain}/rpc?apikey=${import.meta.env.VITE_PIMLICO_API_KEY}`


    const bundlerClient = createClient({
        transport: http(pimlicoEndpoint),
        chain: sepolia as Chain,
    })
        .extend(bundlerActions(ENTRYPOINT_ADDRESS_V07))
        .extend(pimlicoBundlerActions(ENTRYPOINT_ADDRESS_V07))

     const paymasterClient = createPimlicoPaymasterClient({
        transport: http(pimlicoEndpoint),
        entryPoint: ENTRYPOINT_ADDRESS_V07,
    })
    

    const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOperationHash as Hex })

    return receipt;

}




const buildInitSafe7579 = async ( ): Promise<BaseTransaction> => {

    
    const info = await getSafeInfo()

    const provider = await getProvider()
    // Updating the provider RPC if it's from the Safe App.
    const chainId = (await provider.getNetwork()).chainId.toString()
    const bProvider = await getJsonRpcProvider(chainId)

    const safeValidator = new Contract(
        safe7579Module,
        Safe7579.abi,
        bProvider
    )

    return {
        to: safe7579Module,
        value: "0",
        data: (await safeValidator.initializeAccount.populateTransaction([], [], [], [], {registry: ZeroAddress, attesters: [], threshold: 0})).data
    }
}




const buildInstallValidator = async ( ): Promise<BaseTransaction> => {

    
    const info = await getSafeInfo()

    const provider = await getProvider()
    // Updating the provider RPC if it's from the Safe App.
    const chainId = (await provider.getNetwork()).chainId.toString()
    const bProvider = await getJsonRpcProvider(chainId)

    const safeValidator = new Contract(
        safe7579Module,
        Safe7579.abi,
        bProvider
    )

    return {
        to: info.safeAddress,
        value: "0",
        data: (await safeValidator.installModule.populateTransaction(1, spendLimitModule, '0x')).data
    }
}


const buildInstallExecutor = async ( ): Promise<BaseTransaction> => {

    
    const info = await getSafeInfo()

    const provider = await getProvider()
    // Updating the provider RPC if it's from the Safe App.
    const chainId = (await provider.getNetwork()).chainId.toString()
    const bProvider = await getJsonRpcProvider(chainId)

    const safeValidator = new Contract(
        safe7579Module,
        Safe7579.abi,
        bProvider
    )

    return {
        to: info.safeAddress,
        value: "0",
        data: (await safeValidator.installModule.populateTransaction(2, spendLimitModule, '0x')).data
    }
}






const buildAddSessionKey = async (sessionKey: string, token: string, amount: string, refreshInterval: number, validAfter: number, validUntil: number ): Promise<BaseTransaction> => {

    
    const info = await getSafeInfo()

    const sessionData = {account: info.safeAddress, validAfter: validAfter, validUntil: validUntil, limitAmount: parseEther(amount), limitUsed: 0, lastUsed: 0, refreshInterval: refreshInterval }

    const provider = await getProvider()
    // Updating the provider RPC if it's from the Safe App.
    const chainId = (await provider.getNetwork()).chainId.toString()
    const bProvider = await getJsonRpcProvider(chainId)

    const spendLimit = new Contract(
        spendLimitModule,
        SpendLimitSession.abi,
        bProvider
    )

    return {
        to: spendLimitModule,
        value: "0",
        data: (await spendLimit.addSessionKey.populateTransaction(sessionKey, token, sessionData)).data
    }
}



export const createSessionKey = async (token: string, amount: string, refreshInterval: number, validAfter: number, validUntil: number, address: string ): Promise<{address: string, privateKey: string}> => {

    
    if (!await isConnectedToSafe()) throw Error("Not connected to a Safe")

    const info = await getSafeInfo()

    const txs: BaseTransaction[] = []



    if (!await isModuleEnabled(info.safeAddress, safe7579Module)) {
        txs.push(await buildEnableModule(info.safeAddress, safe7579Module))
        txs.push(await buildUpdateFallbackHandler(info.safeAddress, safe7579Module))
        txs.push(await buildInitSafe7579())

        txs.push(await buildInstallValidator())
        txs.push(await buildInstallExecutor())
    }


    txs.push(await buildAddSessionKey(address, token, amount, refreshInterval, validAfter, validUntil))

    const provider = await getProvider()
    // Updating the provider RPC if it's from the Safe App.
    const chainId = (await provider.getNetwork()).chainId.toString()

    if (txs.length == 0) return {address: '', privateKey: ''}
    await submitTxs(txs)

    return {address: '', privateKey: ''}
}
