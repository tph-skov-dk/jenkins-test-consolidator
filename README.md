# jtc

currently, updates are done manually by creating and pushing a tag, running mkrel.bat and then uploading the resulting binary to the jenkins build server, (and creating a release in github with the binary) where it is chown'ed and chmod +x'ed and placed into /home/jenkins/jenkins-test-consolidator

i am not proud of this approach, but it is updated so infrequently i did not bother taking the time to do it properly.