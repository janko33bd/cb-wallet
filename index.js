"use strict";

var API = require('cb-blockr')
var discover = require('bip32-utils').discovery
var bip39 = require('bip39')
var bitcoin = require('bitcoinjs-lib')
var async = require('async')
var TxGraph = require('bitcoin-tx-graph')

function Wallet(externalAccount, internalAccount, networkName, txGraph, done) {
  try {
    this.externalAccount = bitcoin.HDNode.fromBase58(externalAccount)
    this.internalAccount = bitcoin.HDNode.fromBase58(internalAccount)
  } catch(e) {
    return done(e)
  }

  this.api = new API(networkName)

  if(typeof txGraph === 'function') {
    done = txGraph
    this.txGraph = new TxGraph()

    var that = this
    initializeGraph(this.txGraph, [this.externalAccount, this.internalAccount], this.api, networkName, function(err) {
      if(err) return done(err);
      done(null, that)
    })
  } else {
    this.txGraph = txGraph
    done(null, this)
  }
}

function initializeGraph(txGraph, accounts, api, networkName, done) {
  var functions = accounts.map(function(account) {
    return discoverFn(account, api)
  })

  async.parallel(functions, function(err, results) {
    if(err) return done(err);

    var addresses = results[0].addresses.concat(results[1].addresses)

    // var balance = results[0].balance + results[1].balance
    // console.log(addresses, balance)

    api.addresses.transactions(addresses, null, function(err, transactions) {
      if(err) return done(err);

      addTransactionsToGraph(transactions, txGraph)

      var fundingTxIds = txGraph.getTails().map(function(node) {
        return node.id
      })
      api.transactions.get(fundingTxIds, function(err, transactions) {
        if(err) return done(err);
        addTransactionsToGraph(transactions, txGraph)

        txGraph.calculateFeesAndValues(addresses, bitcoin.networks[networkName])
        done()
      })
    })
  })
}

function discoverFn(account, api) {
  return function(callback) { discoverUsedAddresses(account, api, callback) }
}

function addTransactionsToGraph(transactions, graph) {
  transactions.forEach(function(t) {
    var tx = bitcoin.Transaction.fromHex(t.hex)
    tx.confirmations = t.confirmations

    graph.addTx(tx)
  })
}

function discoverUsedAddresses(account, api, done) {
  var usedAddresses = []
  var balance = 0

  discover(account, 5, function(addresses, callback) {

    usedAddresses = usedAddresses.concat(addresses)

    api.addresses.get(addresses, function(err, results) {
      if (err) return callback(err);

      var areSpent = results.map(function(result) {
        return result.totalReceived > 0
      })

      balance = results.reduce(function(memo, result) {
        return memo + result.balance
      }, balance)

      callback(undefined, areSpent)
    })
  }, function(err, k) {
    if (err) return done(err);

    console.info('Discovered ' + k + ' addresses')

    var data = {
      addresses: usedAddresses.slice(0, k),
      balance: balance
    }
    done(null, data)
  })
}

module.exports = Wallet
