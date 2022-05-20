import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import {ProxyAdmin, ProxyAdmin__factory, Squeeth__factory} from "../types/generated";
import {utils} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre
  const { deploy, get, getOrNull } = deployments
  const { deployer } = await getNamedAccounts()
  const deployerSigner: SignerWithAddress = await ethers.getSigner(deployer)

  /**
   * Provider Deployment Configuration
   */

  // TODO: replace with the address that will be able to upgrade the provider contract
  const OWNER_ADDRESS = ethers.constants.AddressZero

  // TODO: replace with the oracle for your provider
  const ORACLE_ADDRESS = (await getOrNull('ChainlinkOracle_ETH'))?.address || ethers.constants.AddressZero

  // TODO: replace with the name of your provider's contract
  const PROVIDER_NAME = 'Squeeth'

  // TODO: replace with the factory for you provdier's contract
  const PROVIDER_FACTORY = new Squeeth__factory()

  const providerInstance = PROVIDER_FACTORY.attach(ethers.constants.AddressZero);

  // TODO: ensure these arguments match your provider's constructor (not initializer)
  const PROVIDER_CONSTRUCTOR_ARGS = [ORACLE_ADDRESS]

  // TODO: ensure these arguments match your provider's initializer (not constructor)
  const PROVIDER_INITIALIZE_DATA = providerInstance.interface.encodeFunctionData("initialize", [
    utils.parseEther('0.30'),
    utils.parseEther('0.10'),
    0,
    0,
    utils.parseEther('1'),
    {
      minRate: 0,
      maxRate: utils.parseEther('5.00'),
      targetRate: utils.parseEther('0.80'),
      targetUtilization: utils.parseEther('0.80'),
    }
  ])

  console.log(`using owner address: ${OWNER_ADDRESS}`)
  console.log(`using oracle address: ${ORACLE_ADDRESS}`)

  /**
   * Provider Deployment Logic
   */

  await deploy('ProxyAdmin', {
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })
  const proxyAdmin: ProxyAdmin = new ProxyAdmin__factory(deployerSigner).attach((await get('ProxyAdmin')).address)

  const providerImpl = await deploy(PROVIDER_NAME, {
    from: deployer,
    args: PROVIDER_CONSTRUCTOR_ARGS,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  const provider = await deploy(`${PROVIDER_NAME}_Proxy`, {
    contract: 'TransparentUpgradeableProxy',
    args: [providerImpl.address, proxyAdmin.address, PROVIDER_INITIALIZE_DATA],
    from: deployer,
    skipIfAlreadyDeployed: true,
    log: true,
    autoMine: true,
  })

  if (await proxyAdmin.owner() !== OWNER_ADDRESS) {
    console.log("setting proxy admin owner...")
    await proxyAdmin.transferOwnership(OWNER_ADDRESS)
  }

  console.log(`Successfully deployed provider ${PROVIDER_NAME} @ ${provider.address}!`)
}

export default func
func.tags = ['Provider']
