import { expect } from 'chai'
import { deployments, ethers } from 'hardhat'
import { getTestSafe, getEntryPoint, getTestToken, getSafe7579, getMockValidator, getMockTarget, getSpendLimitModule } from '../utils/setup'
import { logGas } from '../../src/utils/execution'
import {
  buildUnsignedUserOpTransaction,
} from '../../src/utils/userOp'
import execSafeTransaction from '../utils/execSafeTransaction';
import { ZeroAddress } from 'ethers';
import { Hex, pad } from 'viem'


describe('Spendlimit session key - Basic tests', () => {
  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture()

    const [user1, user2, relayer] = await ethers.getSigners()
    let entryPoint = await getEntryPoint()

    entryPoint = entryPoint.connect(relayer)
    const spendLimitModule = await getSpendLimitModule()
    const mockValidator = await getMockValidator()
    const mockTarget = await getMockTarget()
    const safe7579 = await getSafe7579()
    const testToken = await getTestToken()
    const safe = await getTestSafe(user1, await safe7579.getAddress(), await safe7579.getAddress())

    return {
      testToken,
      user1,
      user2,
      safe,
      relayer,
      mockValidator,
      mockTarget,
      spendLimitModule,
      safe7579,
      entryPoint,
    }
  })


    it('should add a ownable validator and execute ops with signatures', async () => {
      const { user1, user2, safe, spendLimitModule, safe7579, entryPoint, relayer } = await setupTests()

      await entryPoint.depositTo(await safe.getAddress(), { value: ethers.parseEther('1.0') })

      await user1.sendTransaction({ to: await safe.getAddress(), value: ethers.parseEther('1') })

      const abi = [
        'function execute(address sessionKey, address to, uint256 value, bytes calldata data) external',
      ]

      const execCallData = new ethers.Interface(abi).encodeFunctionData('execute', [user1.address, user1.address, ethers.parseEther('1'), '0x' as Hex])

      const newCall = {target: await spendLimitModule.getAddress() as Hex, value: 0, callData: execCallData as Hex}
     
      const currentTime = Math.floor(Date.now()/1000)
      const sessionData = {account: await safe.getAddress(), validAfter: currentTime, validUntil: currentTime + 30, limitAmount: ethers.parseEther('1'), limitUsed: 0, lastUsed: 0, refreshInterval: 0 }


      await execSafeTransaction(safe, await safe7579.initializeAccount.populateTransaction([], [], [], [], {registry: ZeroAddress, attesters: [], threshold: 0}));

      await execSafeTransaction(safe, {to: await safe.getAddress(), data:  ((await safe7579.installModule.populateTransaction(1, await spendLimitModule.getAddress(), '0x')).data as string), value: 0})
      await execSafeTransaction(safe, {to: await safe.getAddress(), data:  ((await safe7579.installModule.populateTransaction(2, await spendLimitModule.getAddress(), '0x')).data as string), value: 0})
      await execSafeTransaction(safe, await spendLimitModule.addSessionKey.populateTransaction(user1.address, ZeroAddress, sessionData))
      

      const key = BigInt(pad(await spendLimitModule.getAddress() as Hex, {
          dir: "right",
          size: 24,
        }) || 0
      )
      const currentNonce = await entryPoint.getNonce(await safe.getAddress(), key);


      let userOp = buildUnsignedUserOpTransaction(await safe.getAddress(), currentNonce, newCall)

      const typedDataHash = ethers.getBytes(await entryPoint.getUserOpHash(userOp))
      userOp.signature = await user1.signMessage(typedDataHash)
      
      await logGas('Execute UserOp without a prefund payment', entryPoint.handleOps([userOp], relayer))
      expect(await ethers.provider.getBalance(await safe.getAddress())).to.be.eq(ethers.parseEther('0'))


    })



    it('should execute multiple session key transaction within limit and time interval', async () => {
      const { user1, user2, safe, spendLimitModule, safe7579, entryPoint, relayer } = await setupTests()

      await entryPoint.depositTo(await safe.getAddress(), { value: ethers.parseEther('1.0') })

      await user1.sendTransaction({ to: await safe.getAddress(), value: ethers.parseEther('1') })

      const abi = [
        'function execute(address sessionKey, address to, uint256 value, bytes calldata data) external',
      ]

      const execCallData = new ethers.Interface(abi).encodeFunctionData('execute', [user1.address, user1.address, ethers.parseEther('0.5'), '0x' as Hex])

      const newCall = {target: await spendLimitModule.getAddress() as Hex, value: 0, callData: execCallData as Hex}
     
      const currentTime = Math.floor(Date.now()/1000)
      const sessionData = {account: await safe.getAddress(), validAfter: currentTime, validUntil: currentTime + 30, limitAmount: ethers.parseEther('1'), limitUsed: 0, lastUsed: 0, refreshInterval: 0 }


      await execSafeTransaction(safe, await safe7579.initializeAccount.populateTransaction([], [], [], [], {registry: ZeroAddress, attesters: [], threshold: 0}));

      await execSafeTransaction(safe, {to: await safe.getAddress(), data:  ((await safe7579.installModule.populateTransaction(1, await spendLimitModule.getAddress(), '0x')).data as string), value: 0})
      await execSafeTransaction(safe, {to: await safe.getAddress(), data:  ((await safe7579.installModule.populateTransaction(2, await spendLimitModule.getAddress(), '0x')).data as string), value: 0})
       await execSafeTransaction(safe, await spendLimitModule.addSessionKey.populateTransaction(user1.address, ZeroAddress, sessionData))
      

      const key = BigInt(pad(await spendLimitModule.getAddress() as Hex, {
          dir: "right",
          size: 24,
        }) || 0
      )
      let currentNonce = await entryPoint.getNonce(await safe.getAddress(), key);


      let userOp = buildUnsignedUserOpTransaction(await safe.getAddress(), currentNonce, newCall)

      let typedDataHash = ethers.getBytes(await entryPoint.getUserOpHash(userOp))
      userOp.signature = await user1.signMessage(typedDataHash)
      
      await logGas('Execute UserOp without a prefund payment', entryPoint.handleOps([userOp], relayer))
      expect(await ethers.provider.getBalance(await safe.getAddress())).to.be.eq(ethers.parseEther('0.5'))


      currentNonce = await entryPoint.getNonce(await safe.getAddress(), key);
      userOp = buildUnsignedUserOpTransaction(await safe.getAddress(), currentNonce, newCall)

      typedDataHash = ethers.getBytes(await entryPoint.getUserOpHash(userOp))
      userOp.signature = await user1.signMessage(typedDataHash)
      
      await logGas('Execute UserOp without a prefund payment', entryPoint.handleOps([userOp], relayer))
      expect(await ethers.provider.getBalance(await safe.getAddress())).to.be.eq(ethers.parseEther('0'))

    })


    it('should execute multiple session key transaction within limit and after refresh interval', async () => {
      const { user1, user2, safe, spendLimitModule, safe7579, entryPoint, relayer } = await setupTests()

      await entryPoint.depositTo(await safe.getAddress(), { value: ethers.parseEther('1.0') })

      await user1.sendTransaction({ to: await safe.getAddress(), value: ethers.parseEther('1') })

      const abi = [
        'function execute(address sessionKey, address to, uint256 value, bytes calldata data) external',
      ]

      const execCallData = new ethers.Interface(abi).encodeFunctionData('execute', [user1.address, user1.address, ethers.parseEther('0.5'), '0x' as Hex])

      const newCall = {target: await spendLimitModule.getAddress() as Hex, value: 0, callData: execCallData as Hex}
     
      const currentTime = Math.floor(Date.now()/1000)
      const sessionData = {account: await safe.getAddress(), validAfter: currentTime, validUntil: currentTime + 30, limitAmount: ethers.parseEther('0.5'), limitUsed: 0, lastUsed: 0, refreshInterval: 5 }


      await execSafeTransaction(safe, await safe7579.initializeAccount.populateTransaction([], [], [], [], {registry: ZeroAddress, attesters: [], threshold: 0}));

      await execSafeTransaction(safe, {to: await safe.getAddress(), data:  ((await safe7579.installModule.populateTransaction(1, await spendLimitModule.getAddress(), '0x')).data as string), value: 0})
      await execSafeTransaction(safe, {to: await safe.getAddress(), data:  ((await safe7579.installModule.populateTransaction(2, await spendLimitModule.getAddress(), '0x')).data as string), value: 0})
       await execSafeTransaction(safe, await spendLimitModule.addSessionKey.populateTransaction(user1.address, ZeroAddress, sessionData))
      

      const key = BigInt(pad(await spendLimitModule.getAddress() as Hex, {
          dir: "right",
          size: 24,
        }) || 0
      )
      let currentNonce = await entryPoint.getNonce(await safe.getAddress(), key);


      let userOp = buildUnsignedUserOpTransaction(await safe.getAddress(), currentNonce, newCall)

      let typedDataHash = ethers.getBytes(await entryPoint.getUserOpHash(userOp))
      userOp.signature = await user1.signMessage(typedDataHash)
      
      await logGas('Execute UserOp without a prefund payment', entryPoint.handleOps([userOp], relayer))
      expect(await ethers.provider.getBalance(await safe.getAddress())).to.be.eq(ethers.parseEther('0.5'))


        // Wait for 5 seconds for the next subscription interval
        await delay(5000);

      currentNonce = await entryPoint.getNonce(await safe.getAddress(), key);
      userOp = buildUnsignedUserOpTransaction(await safe.getAddress(), currentNonce, newCall)

      typedDataHash = ethers.getBytes(await entryPoint.getUserOpHash(userOp))
      userOp.signature = await user1.signMessage(typedDataHash)
      
      await logGas('Execute UserOp without a prefund payment', entryPoint.handleOps([userOp], relayer))
      expect(await ethers.provider.getBalance(await safe.getAddress())).to.be.eq(ethers.parseEther('0'))

    })
  
})

function delay(timeout = 10000): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeout));
}
