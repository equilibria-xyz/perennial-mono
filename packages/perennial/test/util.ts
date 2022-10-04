import { constants, utils, BigNumberish } from 'ethers'
import { IMultiInvoker } from '../types/generated/contracts/interfaces/IMultiInvoker'

export type InvokerAction =
  | 'NOOP'
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'OPEN_TAKE'
  | 'CLOSE_TAKE'
  | 'OPEN_MAKE'
  | 'CLOSE_MAKE'
  | 'CLAIM'
  | 'WRAP'
  | 'UNWRAP'

export const buildInvokerActions = (
  userAddress: string,
  productAddress: string,
  position: BigNumberish,
  amount: BigNumberish,
  programs: number[],
): { [action in InvokerAction]: IMultiInvoker.InvocationStruct } => {
  return {
    NOOP: {
      action: 0,
      product: constants.AddressZero,
      args: '0x',
    },
    DEPOSIT: {
      action: 1,
      product: productAddress,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [userAddress, amount]),
    },
    WITHDRAW: {
      action: 2,
      product: productAddress,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [userAddress, amount]),
    },
    OPEN_TAKE: {
      action: 3,
      product: productAddress,
      args: utils.defaultAbiCoder.encode(['uint'], [position]),
    },
    CLOSE_TAKE: {
      action: 4,
      product: productAddress,
      args: utils.defaultAbiCoder.encode(['uint'], [position]),
    },
    OPEN_MAKE: {
      action: 5,
      product: productAddress,
      args: utils.defaultAbiCoder.encode(['uint'], [position]),
    },
    CLOSE_MAKE: {
      action: 6,
      product: productAddress,
      args: utils.defaultAbiCoder.encode(['uint'], [position]),
    },
    CLAIM: {
      action: 7,
      product: productAddress,
      args: utils.defaultAbiCoder.encode(['uint[]'], [programs]),
    },
    WRAP: {
      action: 8,
      product: constants.AddressZero,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [userAddress, amount]),
    },
    UNWRAP: {
      action: 9,
      product: constants.AddressZero,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [userAddress, amount]),
    },
  }
}
