#define CL_TARGET_OPENCL_VERSION 120
#include <CL/cl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <inttypes.h>
#include "blake8.h"
#define OK(expr) do {cl_int code=(expr); if(code!=CL_SUCCESS){fprintf(stderr,"%s: %d at line %d\n",#expr,code,__LINE__);exit(1);}}while(0)
#define EXPECT(expr,want) do {cl_int code=(expr);if(code!=(want)){fprintf(stderr,"%s: expected %d got %d\n",#expr,(int)(want),code);exit(1);}}while(0)
static int callbacks;
static void CL_CALLBACK completed(cl_event event,cl_int status,void *unused)
{
    (void)unused;cl_int read_status=1;
    OK(clGetEventInfo(event,CL_EVENT_COMMAND_EXECUTION_STATUS,sizeof read_status,&read_status,NULL));
    if(status!=CL_COMPLETE || read_status!=CL_COMPLETE)exit(1);
    ++callbacks;
}
static void args(cl_kernel k,uint64_t root[4],uint64_t base,uint64_t threshold,cl_mem result,cl_mem flag)
{
    for(unsigned i=0;i<4;++i)OK(clSetKernelArg(k,i,8,&root[i]));
    OK(clSetKernelArg(k,4,8,&base));OK(clSetKernelArg(k,5,8,&threshold));
    OK(clSetKernelArg(k,6,sizeof result,&result));OK(clSetKernelArg(k,7,sizeof flag,&flag));
}
int main(int argc,char **argv)
{
    if(argc!=4){fprintf(stderr,"usage: snbcl-smoke pow.cl ROOT64 THRESHOLD_HEX\n");return 2;}
    if(strlen(argv[2])!=64)return 2;
    uint64_t root[4]={0};
    for(unsigned i=0;i<32;++i){char part[3]={argv[2][i*2],argv[2][i*2+1],0};char *end;unsigned long b=strtoul(part,&end,16);if(*end)return 2;root[i/8]|=(uint64_t)b<<(8*(i%8));}
    FILE *file=fopen(argv[1],"rb");if(!file)return 2;
    if(fseek(file,0,SEEK_END))return 2;
    long bytes=ftell(file);if(bytes<=0 || bytes>(1<<20))return 2;
    rewind(file);char *source=malloc((size_t)bytes+1);if(!source)return 2;
    if(fread(source,1,(size_t)bytes,file)!=(size_t)bytes)return 2;
    fclose(file);source[bytes]=0;size_t length=(size_t)bytes;
    cl_uint np;OK(clGetPlatformIDs(0,NULL,&np));if(np!=1)return 1;
    cl_platform_id platform;cl_device_id device;cl_int err;
    OK(clGetPlatformIDs(1,&platform,NULL));OK(clGetDeviceIDs(platform,CL_DEVICE_TYPE_GPU,1,&device,NULL));
    char name[256];OK(clGetDeviceInfo(device,CL_DEVICE_NAME,sizeof name,name,NULL));printf("DEVICE %s\n",name);
    cl_context ctx=clCreateContext(NULL,1,&device,NULL,NULL,&err);OK(err);
    cl_command_queue queue=clCreateCommandQueue(ctx,device,CL_QUEUE_PROFILING_ENABLE,&err);OK(err);
    const char *bad_source="__kernel void other(void) {}";
    cl_program bad=clCreateProgramWithSource(ctx,1,&bad_source,NULL,&err);OK(err);
    EXPECT(clBuildProgram(bad,1,&device,NULL,NULL,NULL),CL_BUILD_PROGRAM_FAILURE);
    cl_build_status status;OK(clGetProgramBuildInfo(bad,device,CL_PROGRAM_BUILD_STATUS,sizeof status,&status,NULL));
    if(status!=CL_BUILD_ERROR)return 1;
    OK(clReleaseProgram(bad));
    const char *parts[2]={source,source+length/2};size_t lengths[2]={length/2,length-length/2};
    cl_program program=clCreateProgramWithSource(ctx,2,parts,lengths,&err);OK(err);
    OK(clBuildProgram(program,1,&device,NULL,NULL,NULL));
    cl_kernel k=clCreateKernel(program,"pow_kernel",&err);OK(err);
    cl_mem result=clCreateBuffer(ctx,CL_MEM_READ_WRITE,8,NULL,&err);OK(err);
    cl_mem flag=clCreateBuffer(ctx,CL_MEM_READ_WRITE,4,NULL,&err);OK(err);
    cl_uint before,after;
    OK(clGetContextInfo(ctx,CL_CONTEXT_REFERENCE_COUNT,sizeof before,&before,NULL));
    for(unsigned i=0;i<1000;++i) {
        cl_mem m=clCreateBuffer(ctx,CL_MEM_READ_WRITE,16,NULL,&err);OK(err);
        OK(clRetainMemObject(m));cl_uint refs;
        OK(clGetMemObjectInfo(m,CL_MEM_REFERENCE_COUNT,sizeof refs,&refs,NULL));if(refs!=2)return 1;
        OK(clReleaseMemObject(m));OK(clReleaseMemObject(m));
    }
    OK(clGetContextInfo(ctx,CL_CONTEXT_REFERENCE_COUNT,sizeof after,&after,NULL));if(before!=after)return 1;
    size_t global=64,local=64;uint32_t zero=0,found=0;
    EXPECT(clEnqueueNDRangeKernel(queue,k,1,NULL,&global,NULL,0,NULL,NULL),CL_INVALID_KERNEL_ARGS);
    args(k,root,0,0,result,flag);
    EXPECT(clSetKernelArg(k,0,4,root),CL_INVALID_ARG_SIZE);
    size_t invalid_local=65;
    EXPECT(clEnqueueNDRangeKernel(queue,k,1,NULL,&global,&invalid_local,0,NULL,NULL),CL_INVALID_WORK_GROUP_SIZE);
    EXPECT(clEnqueueReadBuffer(queue,flag,CL_TRUE,SIZE_MAX,4,&found,0,NULL,NULL),CL_INVALID_VALUE);
    OK(clEnqueueWriteBuffer(queue,flag,CL_TRUE,0,4,&zero,0,NULL,NULL));
    cl_event event;
    OK(clEnqueueNDRangeKernel(queue,k,1,NULL,&global,&local,0,NULL,&event));
    OK(clSetEventCallback(event,CL_COMPLETE,completed,NULL));OK(clWaitForEvents(1,&event));
    cl_ulong start,end;OK(clGetEventProfilingInfo(event,CL_PROFILING_COMMAND_START,sizeof start,&start,NULL));
    OK(clGetEventProfilingInfo(event,CL_PROFILING_COMMAND_END,sizeof end,&end,NULL));if(end<start || callbacks!=1)return 1;
    OK(clReleaseEvent(event));
    uint64_t nonce;OK(clEnqueueReadBuffer(queue,result,CL_TRUE,0,8,&nonce,0,NULL,NULL));if(nonce!=0)return 1;
    /* A pre-set flag must preserve an earlier winner. */
    uint64_t marker=UINT64_C(0x123456789abcdef0);uint32_t one=1;
    OK(clEnqueueWriteBuffer(queue,result,CL_TRUE,0,8,&marker,0,NULL,NULL));
    OK(clEnqueueWriteBuffer(queue,flag,CL_TRUE,0,4,&one,0,NULL,NULL));
    OK(clEnqueueNDRangeKernel(queue,k,1,NULL,&global,NULL,0,NULL,NULL));
    OK(clEnqueueReadBuffer(queue,result,CL_TRUE,0,8,&nonce,0,NULL,NULL));if(nonce!=marker)return 1;
    /* Global offset and u64 wrap must follow the matched source, not alignment. */
    uint64_t base=UINT64_MAX-7,threshold=0;size_t offset=5;
    args(k,root,base,threshold,result,flag);OK(clEnqueueFillBuffer(queue,flag,&zero,4,0,4,0,NULL,NULL));
    OK(clEnqueueNDRangeKernel(queue,k,1,&offset,&global,NULL,0,NULL,NULL));
    OK(clEnqueueReadBuffer(queue,result,CL_TRUE,0,8,&nonce,0,NULL,NULL));if(nonce!=base+offset)return 1;
    base=UINT64_MAX-15;threshold=UINT64_MAX;args(k,root,base,threshold,result,flag);
    OK(clEnqueueWriteBuffer(queue,flag,CL_TRUE,0,4,&zero,0,NULL,NULL));
    OK(clEnqueueNDRangeKernel(queue,k,1,NULL,&global,NULL,0,NULL,NULL));
    OK(clEnqueueReadBuffer(queue,flag,CL_TRUE,0,4,&found,0,NULL,NULL));if(found)return 1;
    puts("PASS contract: source refusal, split source, typed args, bounds, events/callback/profiling, existing winner, offset, wrap");
    threshold=strtoull(argv[3],NULL,16);base=3;global=65536;
    for(unsigned iter=0;iter<100000;++iter,base+=global) {
        args(k,root,base,threshold,result,flag);
        OK(clEnqueueWriteBuffer(queue,flag,CL_TRUE,0,4,&zero,0,NULL,NULL));
        OK(clEnqueueNDRangeKernel(queue,k,1,NULL,&global,NULL,0,NULL,NULL));
        OK(clEnqueueReadBuffer(queue,flag,CL_TRUE,0,4,&found,0,NULL,NULL));
        if(found) {
            OK(clEnqueueReadBuffer(queue,result,CL_TRUE,0,8,&nonce,0,NULL,NULL));
            uint64_t h=blake8_hash(nonce,root);if(h<threshold)return 1;
            printf("SMOKE SOLVED nonce=0x%016" PRIx64 " h0=0x%016" PRIx64 " enqueues=%u\n",nonce,h,iter+1);break;
        }
    }
    OK(clFinish(queue));OK(clReleaseMemObject(result));OK(clReleaseMemObject(flag));
    OK(clReleaseKernel(k));OK(clReleaseProgram(program));OK(clReleaseCommandQueue(queue));OK(clReleaseContext(ctx));
    free(source);return found ? 0 : 3;
}
