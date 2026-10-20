#include "snb-engine-api.h"
#include "blake8.h"
#include <assert.h>
#include <stdio.h>
#include <stdint.h>
int main(void)
{
    assert(!snb_engine_open("/dev/null",16));
    uint8_t root[32]={0}; root[31]=1;
    uint64_t root4[4]={0,0,0,UINT64_C(1)<<56};
    uint64_t bases[]={0,1,15,16,0xfffffff1,0xfffffff0,UINT64_MAX-15,UINT64_MAX-3};
    for(unsigned width=8;width<=16;width+=8) {
        snb_engine *e=snb_engine_open(NULL,width);
        if(!e){fprintf(stderr,"%s\n",snb_engine_error());return 1;}
        for(unsigned i=0;i<sizeof bases/sizeof bases[0];++i) {
            uint64_t threshold=blake8_hash(bases[i],root4);
            if(threshold<UINT64_MAX)++threshold;
            int want=0;uint64_t expected=0;
            for(unsigned j=0;j<128;++j)if(blake8_hash(bases[i]+j,root4)>=threshold){want=1;expected=bases[i]+j;break;}
            struct snb_result r;
            int got=snb_engine_search(e,root,bases[i],128,threshold,&r);
            if(got!=want || (got==1 && (r.nonce!=expected || r.hash!=blake8_hash(expected,root4)))) {
                fprintf(stderr,"range mismatch width=%u base=%llx got=%d want=%d error=%s\n",width,(unsigned long long)bases[i],got,want,snb_engine_error());return 1;
            }
            got=snb_engine_search(e,root,bases[i],17,UINT64_MAX,&r);
            assert(got==0 && r.gpu_hashes+r.cpu_hashes==17);
        }
        snb_engine_close(e);
    }
    puts("PASS engine: both widths, first hit, arbitrary alignment, exact tails, low-word and u64 wrap, bad blob refusal");
    return 0;
}
