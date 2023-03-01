import { utils, BigNumberish, BigNumber } from 'ethers'
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
  | 'WRAP_AND_DEPOSIT'
  | 'WITHDRAW_AND_UNWRAP'

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
      args: '0x',
    },
    DEPOSIT: {
      action: 1,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    WITHDRAW: {
      action: 2,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    OPEN_TAKE: {
      action: 3,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    CLOSE_TAKE: {
      action: 4,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    OPEN_MAKE: {
      action: 5,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    CLOSE_MAKE: {
      action: 6,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [productAddress, position]),
    },
    CLAIM: {
      action: 7,
      args: utils.defaultAbiCoder.encode(['address', 'uint[]'], [productAddress, programs]),
    },
    WRAP: {
      action: 8,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [userAddress, amount]),
    },
    UNWRAP: {
      action: 9,
      args: utils.defaultAbiCoder.encode(['address', 'uint'], [userAddress, amount]),
    },
    WRAP_AND_DEPOSIT: {
      action: 10,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
    WITHDRAW_AND_UNWRAP: {
      action: 11,
      args: utils.defaultAbiCoder.encode(['address', 'address', 'uint'], [userAddress, productAddress, amount]),
    },
  }
}

export const buildAllActionsRollup = (
  actions: {
    action: BigNumberish
    payload: string
  }[],
  // actions: {
  //   action: InvokerAction
  //   userCache: BigNumber | null,
  //   productCache: BigNumber,
  //   userAddress?: string,
  //   productAddress?: string,
  //   position?: BigNumberish,
  //   amount?: BigNumberish,
  //   programs?: number[]
  // }[]
): string => {
  let pld = ''

  for (const a of actions) {
    if (a.action == 'NOOP') {
      continue
    }

    pld += a.payload
  }

  return pld
}

export const buildInvokerActionRollup = (
  userCache: BigNumber, // BN(0) if not used
  productCache: BigNumber, // BN(0) if not used
  userAddress?: string,
  productAddress?: string,
  position?: BigNumberish,
  amount?: BigNumberish,
  programs?: number[],
): { [action in InvokerAction]: { action: BigNumberish; payload: string } } => {
  return {
    NOOP: {
      action: 0,
      payload: '0x',
    },
    DEPOSIT: {
      action: 1,
      // [userAddress productAddress amount]
      payload:
        '01' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(amount)),
    },
    WITHDRAW: {
      action: 2,
      // [userAddress productAddress amount]
      payload:
        '02' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(amount)),
    },
    OPEN_TAKE: {
      action: 3,
      // [productAddress position]
      payload: '03' + encodeAddressOrCacheIndex(productCache, productAddress) + encodeUint(BigNumber.from(position)),
    },
    CLOSE_TAKE: {
      action: 4,
      // [productAddress position]
      payload: '04' + encodeAddressOrCacheIndex(productCache, productAddress) + encodeUint(BigNumber.from(position)),
    },
    OPEN_MAKE: {
      action: 5,
      // [productAddress position]
      payload: '05' + encodeAddressOrCacheIndex(productCache, productAddress) + encodeUint(BigNumber.from(position)),
    },
    CLOSE_MAKE: {
      action: 6,
      // [productAddress position]
      payload: '06' + encodeAddressOrCacheIndex(productCache, productAddress) + encodeUint(BigNumber.from(position)),
    },
    CLAIM: {
      action: 7,
      // [productAddress programs]
      payload: '07' + encodeAddressOrCacheIndex(productCache, productAddress) + encodeProgramIds(programs!),
    },
    WRAP: {
      action: 8,
      // [userAddress amount]
      payload: '08' + encodeAddressOrCacheIndex(userCache, userAddress) + encodeUint(BigNumber.from(amount)),
    },
    UNWRAP: {
      action: 9,
      // [userAddress amount]
      payload: '09' + encodeAddressOrCacheIndex(userCache, userAddress) + encodeUint(BigNumber.from(amount)),
    },
    WRAP_AND_DEPOSIT: {
      action: 10,
      // [userAddress, productAddress, amount]
      payload:
        '0A' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(amount)),
    },
    WITHDRAW_AND_UNWRAP: {
      action: 11,
      // [userAddress, productAddress, amount]
      payload:
        '0B' +
        encodeAddressOrCacheIndex(userCache, userAddress) +
        encodeAddressOrCacheIndex(productCache, productAddress) +
        encodeUint(BigNumber.from(amount)),
    },
  }
}

export const encodeUint = (uint: BigNumber) => {
  if (uint.eq(0)) return '0100'
  return toHex((uint._hex.length - 2) / 2) + toHex(uint._hex)
}

export const encodeAddressOrCacheIndex = (
  cacheIndex: BigNumber, // must not be null, default to BN(0) and pass address if user's first interaction with protocol
  address?: string,
) => {
  // include address if first interaction with the protocol,
  // contract reads the next 20 bytes into an address when given an address length of 0
  if (address) return '00' + address.slice(2)

  //
  return encodeUint(cacheIndex)
}

export const encodeProgramIds = (programs: number[]) => {
  let encoded = toHex(BigNumber.from(programs.length))

  programs.forEach(program => {
    encoded += encodeUint(BigNumber.from(program))
  })

  return encoded
}

function toHex(input: BigNumberish): string {
  return BigNumber.from(input)._hex.slice(2)
}
