import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { constants, utils } from 'ethers'
import { createPayoffDefinition } from '../../../../common/testutil/types'
import { IController__factory, IProduct, IProduct__factory } from '../../../types/generated'

export interface DeployProductParams extends Partial<Omit<IProduct.ProductInfoStruct, 'payoffDefinition'>> {
  name: string
  symbol: string
  owner: SignerWithAddress
  baseCurrency: string
  quoteCurrency: string
  short: boolean
  payoffOracle?: string
}

// Deploys a product that uses an oracle based on an oracle in the Chainlink feed registry.
// Returns the address of the deployed product.
export async function deployProductOnMainnetFork({
  name,
  symbol,
  owner,
  oracle,
  short,
  payoffOracle,
  maintenance,
  fundingFee,
  makerFee,
  takerFee,
  positionFee,
  makerLimit,
  utilizationCurve,
}: DeployProductParams): Promise<IProduct> {
  const productInfo: IProduct.ProductInfoStruct = {
    name: name,
    symbol: symbol,
    payoffDefinition: createPayoffDefinition({ contractAddress: payoffOracle, short: short }),
    oracle: oracle ?? constants.AddressZero,
    maintenance: maintenance ?? utils.parseEther('0.10'),
    fundingFee: fundingFee ?? utils.parseEther('0.00'),
    makerFee: makerFee ?? utils.parseEther('0.0'),
    takerFee: takerFee ?? utils.parseEther('0.0'),
    positionFee: positionFee ?? utils.parseEther('0.0'),
    makerLimit: makerLimit ?? utils.parseEther('100'),
    utilizationCurve: utilizationCurve ?? {
      minRate: utils.parseEther('0.02'),
      maxRate: utils.parseEther('0.08'),
      targetRate: utils.parseEther('0.80'),
      targetUtilization: utils.parseEther('0.80'),
    },
  }

  // This is the controller deployed on mainnet.
  const controller = IController__factory.connect('0x9df509186b6d3b7D033359f94c8b1BB5544d51b3', owner)

  const coordinatorId = await controller.connect(owner).callStatic.createCoordinator()
  await controller.connect(owner).createCoordinator()

  const productAddress = await controller.connect(owner).callStatic.createProduct(coordinatorId, productInfo)
  await controller.connect(owner).createProduct(coordinatorId, productInfo)

  return IProduct__factory.connect(productAddress, owner)
}
