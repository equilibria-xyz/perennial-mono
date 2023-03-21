// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./MultiInvoker.sol";
import "../interfaces/IMultiInvokerRollup.sol";

/// @title A calldata-optimized implementation of the Perennial MultiInvoker 
/// @notice Retains same functionality and `invoke` entry point from inherited MultiInvoker
contract MultiInvokerRollup is IMultiInvokerRollup, MultiInvoker {

    /// @dev the pointer struct for current decoding position in calldata to pass by reference
    struct PTR {
        uint256 pos;
    }

    /// @dev the current number of addresses cached in state
    uint256 public addressNonce;
    /// @dev the table of address nonce to stored address
    mapping(uint => address) public addressCache;
    /// @dev reverse lookup of the above table for constructing calldata
    mapping(address => uint) public addressNonces;

    constructor(
        Token6 usdc_,
        IBatcher batcher_,
        IEmptySetReserve reserve_,
        IController controller_
    ) MultiInvoker(
        usdc_,
        batcher_,
        reserve_,
        controller_
    ) { }

    /// @dev fallback eliminates the need to include function sig in calldata
    fallback (bytes calldata input) external returns (bytes memory){
        _decodeFallbackAndInvoke(input);
        return "";
    }

    /**
     * @notice this function serves exactly the same as invoke(Invocation[] memory invocations),
     * but includes logic to handle the highly packed calldata
     * Encoding Scheme:
     * [0:1] => uint action 
     * [1:2] => uint length of current encoded type 
     * [2:length] => current encoded type (see individual type decoding functions)
     */
    function _decodeFallbackAndInvoke(bytes calldata input) internal {
        PTR memory ptr = PTR(0);
        
        uint len = input.length;
    
        for (ptr.pos; ptr.pos < len;) {
            uint8 action = _toUint8(input, ptr);

            // solidity doesn't like evaluating bytes as enums :/ 
            if (action == 1) { // DEPOSIT
                address account; address product; UFixed18 amount;
                (account, product, amount) = _decodeAddressAddressAmount(input, ptr);

                _deposit(account, IProduct(product), amount);
            } else if (action == 2) { // WITHDRAW
                address receiver; address product; UFixed18 amount;
                (receiver, product, amount) = _decodeAddressAddressAmount(input, ptr);

                _withdraw(receiver, IProduct(product), amount);
            } else if (action == 3) { // OPEN_TAKE
                address product; UFixed18 amount;
                (product, amount) = _decodeAddressAmount(input, ptr);

                _openTakeFor(IProduct(product), amount);  
            } else if (action == 4) { // CLOSE_TAKE
                address product; UFixed18 amount;
                (product, amount) = _decodeAddressAmount(input, ptr);

                _closeTakeFor(IProduct(product), amount);
            } else if (action == 5) { // OPEN_MAKE 
                address product; UFixed18 amount;
                (product, amount) = _decodeAddressAmount(input, ptr);

                _openMakeFor(IProduct(product), amount);
            } else if (action == 6) { // CLOSE_MAKE
                address product; UFixed18 amount;
                (product, amount) = _decodeAddressAmount(input, ptr);

                _closeMakeFor(IProduct(product), amount);
            } else if (action == 7) { // CLAIM 
                address product; uint256[] memory programIds;
                (product, programIds) = _decodeProductPrograms(input, ptr);

                _claimFor(IProduct(product), programIds);
            } else if (action == 8) { // WRAP 
                address receiver; UFixed18 amount;
                (receiver, amount) = _decodeAddressAmount(input, ptr);

                _wrap(receiver, amount);
            } else if (action == 9) { // UNWRAP
                address receiver; UFixed18 amount;
                (receiver, amount) = _decodeAddressAmount(input, ptr);

                _unwrap(receiver, amount);
            } else if (action == 10) { // WRAP_AND_DEPOSIT
                address account; address product; UFixed18 amount;
                (account, product, amount) = _decodeAddressAddressAmount(input, ptr);
                
               _wrapAndDeposit(account, IProduct(product), amount);
            } else if (action == 11) { // WITHDRAW_AND_UNWRAP
                address receiver; address product; UFixed18 amount;
                (receiver, product, amount) = _decodeAddressAddressAmount(input, ptr);

                _withdrawAndUnwrap(receiver, IProduct(product), amount);
            } else if (action == 12) { // VAULT_DEPOSIT
                address depositer; address vault; UFixed18 amount;
                (depositer, vault, amount) = _decodeAddressAddressAmount(input, ptr);

                _vaultDeposit(depositer, IPerennialVault(vault), amount);
            } else if (action == 13) { // VAULT_REDEEM
                address vault; UFixed18 shares;
                (vault, shares) = _decodeAddressAmount(input, ptr);

                _vaultRedeem(IPerennialVault(vault), shares);
            } else if (action == 14) { // VAULT_CLAIM
                address owner; address vault;
                (owner, vault) = _decodeAddressAddress(input, ptr);

                _vaultClaim(IPerennialVault(vault), owner);
            } else if (action == 15) { // VAULT_WRAP_AND_DEPOSIT 
                address account; address vault; UFixed18 amount;
                (account, vault, amount) = _decodeAddressAddressAmount(input, ptr);

                _vaultWrapAndDeposit(account, IPerennialVault(vault), amount);
            }
        }
    }

    /// @notice Unchecked sets address in cache
    /// @param  addr Address to add to cache 
    function _setAddressCache(address addr) private {
        ++addressNonce;
        addressCache[addressNonce] = addr;
        addressNonces[addr] = addressNonce;
        emit AddressAddedToCache(addr, addressNonce);
    }
    
     /**
     * @notice Decodes next bytes of action as address, address
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding
     * @return addr1 First address for action 
     * @return addr2 Second address for action
     */
    function _decodeAddressAddress(bytes calldata input, PTR memory ptr) private returns (address addr1, address addr2) {
        addr1= _decodeAddress(input, ptr);
        addr2 = _decodeAddress(input, ptr);

        return (addr1, addr2);
    }

    /**
     * @notice Decodes next bytes of action as address, address, and UFixed18
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding
     * @return addr1 First address for action 
     * @return addr2 Second address for action
     * @return amount UFixed18 wrpped amount for action
     */
    function _decodeAddressAddressAmount(bytes calldata input, PTR memory ptr) private returns (address addr1, address addr2, UFixed18 amount) {
        addr1 = _decodeAddress(input, ptr);
        addr2 = _decodeAddress(input, ptr);
        amount = _decodeAmountUFixed18(input, ptr);

        return (addr1, addr2, amount);
    }

    /**
     * @notice Decodes next bytes of action as address, UFixed18
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding
     * @return addr1 Address for action
     * @return amount UFixed18 wrapped amount for action
     */
    function _decodeAddressAmount(bytes calldata input, PTR memory ptr) private returns (address addr1, UFixed18 amount) {
        addr1 = _decodeAddress(input, ptr);
        amount = _decodeAmountUFixed18(input, ptr);

        return(addr1, amount);
    }

    /**
     * @notice Decodes next bytes of action as address, uint256[]
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding
     * @return product Address for action
     * @return programs ProgramIds for action
     */
    function _decodeProductPrograms(bytes calldata input, PTR memory ptr) private returns (address product, uint256[] memory programs) {
        product = _decodeAddress(input, ptr);
        programs = _decodeUintArray(input, ptr);

        return(product, programs);
    }

    /** 
     * @notice decodes an address from calldata 
     * @dev if length == 0, stores next 20 bytes as address to cache 
     * else loading address from uint cache index
     * @param input Full calldata payload
     * @param ptr Current index of input to start decoding
     * @return addr Address encoded in calldata
    */
    function _decodeAddress(bytes calldata input, PTR memory ptr) private returns (address addr) {
        uint len = _toUint8(input, ptr);

        // user is new to registry, add next 20 bytes as address to registry and return address
        if (len == 0) {
            addr = _toAddress(input, ptr);

            _setAddressCache(addr);
        } else {
            uint addrNonceLookup = _bytesToUint256(input[ptr.pos:ptr.pos+len]);
            ptr.pos += len;

            addr = _getAddressCache(addrNonceLookup);
        }
    }

    /**
     * @notice Checked gets the address in cache mapped to the cache index
     * @dev    There is an issue with the calldata if a txn uses cache before caching address
     * @param  nonce The cache index
     * @return addr Address stored at cache index
     */
    function _getAddressCache(uint nonce) private view returns (address addr){
        addr = addressCache[nonce];
        if (addr == address(0)) revert MultiInvokerRollupInvalidCalldataError();
    }

    /**
     * @notice Wraps next length of bytes as UFixed18
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding
     * @param  ptr Current index of input to start decoding
     */
     function _decodeAmountUFixed18(bytes calldata input, PTR memory ptr) private view returns (UFixed18 result) {
        return UFixed18.wrap(_toUint256(input, ptr));
    }

    /**
     * @notice Unpacks next length of bytes as lengths of bytes into array of uint256
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding
     * @return ProgramIds for CLAIM action 
     */
    function _decodeUintArray(bytes calldata input, PTR memory ptr) private pure returns (uint256[] memory) {
        uint8 arrayLen = _toUint8(input, ptr);

        uint256[] memory result = new uint256[](arrayLen);

        for (uint count; count < arrayLen;) {
            uint currUint;

            currUint = _toUint256(input, ptr);

            result[count] = currUint;

            ++count;
        }
        return result;
    }

    /**
     * @notice Helper function to get address from calldata
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding 
     * @return addr The decoded address
     */
    function _toAddress(bytes calldata input, PTR memory ptr) private pure returns (address addr) {
        addr = _bytesToAddress(input[ptr.pos:ptr.pos+20]);
        ptr.pos += 20;
    }

    /**
     * @dev This is called in decodeAccount and decodeProduct which both only pass 20 byte slices 
     * @notice Unchecked force of 20 bytes into address
     * @param  input The 20 bytes to be converted to address
     * @return addr Address representation of `input`
    */
    function _bytesToAddress(bytes memory input) private pure returns (address addr) {
        assembly {
            addr := mload(add(input, 20))
        } 
    }

    /**
     * @notice Helper function to get uint8 length from calldata
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding 
     * @return res The decoded uint8 length
     */
    function _toUint8(bytes calldata input, PTR memory ptr) private pure returns (uint8 res) {
        res = _bytesToUint8(input[ptr.pos:ptr.pos+1]);
        ++ptr.pos;
    }

    /**
     * @notice Implementation of GNSPS' standard BytesLib.sol
     * @param  input 1 byte slice to convert to uint8 to decode lengths
     * @return res The uint8 representation of input
     */
    function _bytesToUint8(bytes memory input) private pure returns (uint8 res) {
        assembly {
            res := mload(add(input, 0x1))
        }
    }

    /**
     * @notice Helper function to get uint256 from calldata
     * @param  input Full calldata payload
     * @param  ptr Current index of input to start decoding 
     * @return res The decoded uint256
     */
    function _toUint256(bytes calldata input, PTR memory ptr) private pure returns (uint256 res) {
        uint len = _toUint8(input, ptr);

        res = _bytesToUint256(input[ptr.pos:ptr.pos+len]);
        ptr.pos += len;
    }

    /** 
     * @notice Unchecked loads arbitrarily-sized bytes into a uint
     * @dev    Bytes length enforced as < max word size in above function
     * @param  input The bytes to convert to uint256
     * @return res The resulting uint256
     */
    function _bytesToUint256(bytes memory input) private pure returns (uint256 res) {
        uint len = input.length;

        // length must not exceed max bytes length of a word/uint
        if (len > 32) revert MultiInvokerRollupInvalidCalldataError();

        assembly {
            res := mload(add(input, 0x20))
        }

        if (res == 0x20) {
            return 0;
        }

        // readable right shift to change right padding of mload to left padding
        res >>= 256 - (len * 8);
    }
}