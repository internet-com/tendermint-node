#!/usr/bin/env node

let { createHash } = require('crypto')
let { createWriteStream, readFileSync, renameSync } = require('fs')
let { join } = require('path')
let { get } = require('axios')
let ProgressBar = require('progress')
let unzip = require('unzip').Parse

const TENDERMINT_VERSION = '0.19.2'

console.log(`downloading tendermint v${TENDERMINT_VERSION}`)
let binaryDownloadUrl = getBinaryDownloadURL()
get(binaryDownloadUrl, { responseType: 'stream' }).then((res) => {
  if (res.status !== 200) {
    throw Error(`Request failed, status: ${res.status}`)
  }
  let length = +res.headers['content-length']

  let template = '[:bar] :rate/Mbps :percent :etas'
  let bar = new ProgressBar(template, {
    complete: '=',
    incomplete: ' ',
    width: 20,
    total: length / 1e6 * 8
  })

  let tempBinPath = join(__dirname, '_tendermint')
  let binPath = join(__dirname, 'tendermint')
  let shasumPath = join(__dirname, 'SHA256SUMS')

  // unzip, write to file, and check hash
  let file = createWriteStream(tempBinPath, { mode: 0o755 })
  res.data.pipe(unzip()).once('entry', (entry) => {
    // write to file
    // (a temporary file which we rename if the hash check passes)
    entry.pipe(file)
  })

  // verify hash of file
  // Since the SHA256SUMS file comes from npm, and the binary
  // comes from GitHub, both npm AND GitHub would need to be
  // compromised for the binary download to be compromised.
  let hasher = createHash('sha256')
  res.data.on('data', (chunk) => hasher.update(chunk))
  file.on('finish', () => {
    let actualHash = hasher.digest().toString('hex')

    // get known hash from SHA256SUMS file
    let shasums = readFileSync(shasumPath).toString()
    let expectedHash
    for (let line of shasums.split('\n')) {
      let [ shasum, filename ] = line.split(' ')
      if (binaryDownloadUrl.includes(filename)) {
        expectedHash = shasum
        break
      }
    }

    if (actualHash !== expectedHash) {
      console.error('ERROR: hash of downloaded tendermint binary did not match')
      process.exit(1)
    }

    console.log('✅ verified hash of tendermint binary\n')
    renameSync(tempBinPath, binPath)
  })

  // increment progress bar
  res.data.on('data', (chunk) => bar.tick(chunk.length / 1e6 * 8))
  res.data.on('end', () => console.log())
})

// gets a URL to the binary, hosted on GitHub
function getBinaryDownloadURL (version = TENDERMINT_VERSION) {
  let platforms = {
    'darwin': 'darwin',
    'linux': 'linux',
    'win32': 'windows',
    'freebsd': 'freebsd'
  }
  let arches = {
    'x32': '386',
    'x64': 'amd64',
    'arm': 'arm',
    'arm64': 'arm'
  }
  let platform = platforms[process.platform]
  let arch = arches[process.arch]
  return `https://github.com/tendermint/tendermint/releases/download/v${version}/tendermint_${version}_${platform}_${arch}.zip`
}
