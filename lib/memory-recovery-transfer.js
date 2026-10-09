'use strict';

const fs = require('fs');
const crypto = require('crypto');
const same = (a,b) => ['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
const pathMatches = (p,h) => same(p,h) || (process.platform==='win32' && p.dev===0n && h.dev!==0n && same({...p,dev:h.dev},h));
const regular = stat => stat.isFile() && !stat.isSymbolicLink();
function createRecoveryTransfer(maxChunkBytes) {
  if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1 || maxChunkBytes > 65536) {
    throw Object.assign(new Error('Invalid recovery transfer chunk'),{code:'E_RECOVERY_CHUNK_INVALID'});
  }
  // One scratch buffer per recovery, reused across all sources and attempts.
  const buffer = Buffer.alloc(maxChunkBytes);
  let readBytes = 0;
  const attempts = [];
  const snapshot = () => ({ version: 1, readChunkMaxBytes: maxChunkBytes, sourceBytesRead: readBytes,
    artifactBytesWritten: attempts.reduce((n,a)=>n+a.sink.snapshot().bytesWritten,0),
    attempts: attempts.map(a=>({storage:a.storage,directory:a.directory,...a.sink.snapshot(),
      sources:a.sources.map(item=>({name:item.name,...item.result})),
      allObservedSourcesStable:a.sources.every(item=>item.result.stable||item.result.kind==='missing')})),
    totalSourceBytesBounded: false, retentionBounded: false, physicalReservation: false });
  function start(sink, storage, directory) {
    const sources=[];
    attempts.push({sink,storage,directory,sources});
    const writeBytes = (name, bytes) => sink.write(name,put=>{
      for(let pos=0;pos<bytes.length;pos+=maxChunkBytes)put(bytes.subarray(pos,pos+maxChunkBytes));
    });
    function copy(file, name) {
      const result = { exists: null, kind: 'unreadable', stable: false };
      sources.push({name,result});
      let fd = null, confirmation = null, writingError = null;
      try {
        const before = fs.lstatSync(file,{bigint:true});result.exists = true;
        if(!regular(before)){result.kind=before.isDirectory()?'directory':'other';return result;}
        result.kind = 'file';
        fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
        const opened=fs.fstatSync(fd,{bigint:true});
        if(!regular(opened)||!pathMatches(before,opened)||opened.size>BigInt(Number.MAX_SAFE_INTEGER)) {
          result.error='E_RECOVERY_SOURCE_CHANGED';return result;
        }
        // Finite observed extent: never follow a continuously growing source.
        const expected=Number(opened.size),hash=crypto.createHash('sha256');let position=0,readError=null;
        try {
          sink.write(name,put=>{
            while(position<expected){
              let n;
              try {n=fs.readSync(fd,buffer,0,Math.min(maxChunkBytes,expected-position),position);}
              catch(error){readError=error.code||'read_failed';break;}
              if(n===0){readError='E_RECOVERY_SOURCE_CHANGED';break;}
              readBytes+=n;position+=n;hash.update(buffer.subarray(0,n));put(buffer.subarray(0,n));
            }
          });
        } catch(error){result.error=error.code||'write_failed';writingError=error;throw error;}
        Object.assign(result,{artifact:name,size:position,sha256:hash.digest('hex')});
        const after=fs.fstatSync(fd,{bigint:true}),current=fs.lstatSync(file,{bigint:true});
        let confirmed=true;
        if(process.platform==='win32'&&(before.dev===0n||current.dev===0n)){
          confirmation=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
          const stat=fs.fstatSync(confirmation,{bigint:true});confirmed=regular(stat)&&same(after,stat)&&stat.dev!==0n&&stat.ino!==0n;
        }
        result.stable=!readError&&position===expected&&same(opened,after)&&same(before,current)&&pathMatches(current,after)&&confirmed;
        if(!result.stable)result.error=readError||'E_RECOVERY_SOURCE_CHANGED';
      } catch(error){
        if(writingError)throw writingError;
        if(error.code==='ENOENT'&&fd===null){result.exists=false;result.kind='missing';}
        else result.error=error.code||'read_failed';
      } finally {
        for(const opened of [confirmation,fd])if(opened!==null){try{fs.closeSync(opened);}catch(error){result.stable=false;result.error=error.code||'close_failed';}}
      }
      return result;
    }
    return { writeBytes, copy, snapshot };
  }
  return { start, snapshot };
}
module.exports = { createRecoveryTransfer };
